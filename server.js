import 'dotenv/config'

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import pg from 'pg'

const { Pool } = pg
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    callback(null, !corsOrigins.length || !origin || corsOrigins.includes(origin))
  },
}))
app.use(express.json())

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: false }
    : undefined,
})

const PORT = Number(process.env.PORT || 3000)
const tokens = new Map()

function fail(res, status, message) {
  return res.status(status).json({ error: message })
}

async function getUserByLogin(login) {
  const { rows } = await pool.query(`
    SELECT u.*, r.nombre AS rol,
           a.nombre AS alumno_nombre, a.apellido AS alumno_apellido,
           p.nombre AS profesor_nombre, p.apellido AS profesor_apellido
    FROM usuario u
    LEFT JOIN rol r ON r.id_rol = u.id_rol
    LEFT JOIN alumno a ON a.dni = u.dni_alumno
    LEFT JOIN profesor p ON p.dni = u.dni_profesor
    WHERE u.nombre_usuario = $1
       OR u.dni_alumno = $1
       OR u.dni_profesor = $1
    LIMIT 1
  `, [login])
  return rows[0]
}

async function auth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  const session = token ? tokens.get(token) : null
  if (!session) return fail(res, 401, 'No autenticado')
  req.user = session
  next()
}

function roles(...allowed) {
  return (req, res, next) => {
    if (!req.user || !req.user.rol) {
      return fail(res, 403, 'El usuario no tiene un rol asignado')
    }

    if (!allowed.includes(req.user.rol)) {
      return fail(res, 403, 'No tenés permisos para esta operación')
    }

    next()
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, servicio: 'gestion-notas' })
  } catch {
    res.status(500).json({ ok: false, error: 'No se pudo conectar a PostgreSQL' })
  }
})

app.post('/api/login', async (req, res) => {
  try {
    const { usuario, contrasenia } = req.body
    if (!usuario || !contrasenia) return fail(res, 400, 'Faltan usuario y contraseña')

    const user = await getUserByLogin(usuario)
    if (!user || user.estado !== 'Activo') {
      return fail(res, 401, 'Usuario o contraseña incorrectos')
    }

    const ok = await bcrypt.compare(contrasenia, user.contrasenia)
    if (!ok) return fail(res, 401, 'Usuario o contraseña incorrectos')

    const token = crypto.randomBytes(32).toString('hex')
    const session = {
      id_usuario: user.id_usuario,
      rol: user.rol,
      dni_alumno: user.dni_alumno,
      dni_profesor: user.dni_profesor,
      nombre: user.alumno_nombre
        ? `${user.alumno_apellido}, ${user.alumno_nombre}`
        : user.profesor_nombre
          ? `${user.profesor_apellido}, ${user.profesor_nombre}`
          : user.nombre_usuario,
    }

    tokens.set(token, session)
    await pool.query('UPDATE usuario SET ultimo_acceso = NOW() WHERE id_usuario = $1', [user.id_usuario])
    res.json({ token, usuario: session })
  } catch (error) {
    console.error(error)
    fail(res, 500, 'Error interno')
  }
})

app.post('/api/logout', auth, (req, res) => {
  const token = (req.headers.authorization || '').slice(7)
  tokens.delete(token)
  res.json({ ok: true })
})

app.get('/api/me', auth, (req, res) => res.json(req.user))

app.get('/api/dashboard', auth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH ciclo_actual AS (
        SELECT id_ciclo_lectivo
        FROM ciclo_lectivo
        ORDER BY anio DESC
        LIMIT 1
      ), promedios AS (
        SELECT n.dni_alumno, n.codigo_materia, AVG(n.calificacion) AS promedio
        FROM nota n
        JOIN ciclo_actual ca ON ca.id_ciclo_lectivo=n.id_ciclo_lectivo
        GROUP BY n.dni_alumno, n.codigo_materia
      )
      SELECT
        (SELECT COUNT(DISTINCT a.dni)::int
         FROM alumno a
         JOIN alumno_curso ac ON ac.dni_alumno=a.dni
         JOIN ciclo_actual ca ON ca.id_ciclo_lectivo=ac.id_ciclo_lectivo
         WHERE a.estado='Activo' AND ac.fecha_baja IS NULL) AS alumnos_activos,
        (SELECT COUNT(*)::int FROM promedios WHERE promedio >= 6) AS aprobados,
        (SELECT COUNT(*)::int
         FROM nota n
         JOIN ciclo_actual ca ON ca.id_ciclo_lectivo=n.id_ciclo_lectivo
         WHERE n.observacion IS NOT NULL AND BTRIM(n.observacion) <> '') AS contenidos_incompletos
    `)
    res.json(rows[0])
  } catch (error) {
    console.error(error)
    fail(res, 500, 'No se pudo obtener el panel')
  }
})

app.get('/api/alumnos', auth, async (req, res) => {
  try {
    const cicloLectivo = Number(req.query.ciclo_lectivo) || null
    const { rows } = await pool.query(`
      SELECT a.dni, a.nombre, a.apellido, a.email, a.estado,
             c.id_curso, c.anio, c.division, cl.anio AS ciclo_lectivo,
             COALESCE(ROUND(AVG(n.calificacion), 1), 0) AS promedio
      FROM alumno a
      LEFT JOIN LATERAL (
        SELECT ac.*
        FROM alumno_curso ac
        WHERE ac.dni_alumno=a.dni
          AND ac.id_ciclo_lectivo=(
            SELECT id_ciclo_lectivo FROM ciclo_lectivo
            WHERE ($1::integer IS NULL OR anio=$1)
            ORDER BY anio DESC LIMIT 1
          )
        ORDER BY ac.fecha_inscripcion DESC, ac.fecha_baja NULLS FIRST
        LIMIT 1
      ) ac ON TRUE
      LEFT JOIN curso c ON c.id_curso = ac.id_curso
      LEFT JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo = ac.id_ciclo_lectivo
      LEFT JOIN nota n ON n.dni_alumno = a.dni
        AND n.id_ciclo_lectivo = ac.id_ciclo_lectivo
        AND n.id_curso = ac.id_curso
      GROUP BY a.dni, c.id_curso, cl.anio
      ORDER BY a.apellido, a.nombre
    `, [cicloLectivo])
    res.json(rows)
  } catch (error) {
    console.error(error)
    fail(res, 500, 'No se pudieron obtener los alumnos')
  }
})

app.post('/api/alumnos', auth, roles('admin', 'preceptor'), async (req, res) => {
  const { dni, nombre, apellido, email, estado = 'Activo', id_curso } = req.body
  if (!dni || !nombre || !apellido) {
    return fail(res, 400, 'DNI, nombre y apellido son obligatorios')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`
      INSERT INTO alumno (dni, nombre, apellido, email, estado)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `, [dni, nombre, apellido, email || null, estado])
    if (id_curso) {
      await client.query(`
        INSERT INTO alumno_curso (dni_alumno, id_curso, id_ciclo_lectivo)
        SELECT $1, $2, id_ciclo_lectivo
        FROM ciclo_lectivo ORDER BY anio DESC LIMIT 1
      `, [dni, id_curso])
    }
    await client.query('COMMIT')
    res.status(201).json(rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    console.error(error)
    if (error.code === '23505') return fail(res, 409, 'Ya existe un alumno con ese DNI')
    fail(res, 400, 'No se pudo crear el alumno')
  } finally {
    client.release()
  }
})

app.put('/api/alumnos/:dni', auth, roles('admin', 'preceptor'), async (req, res) => {
  const { dni } = req.params
  const { nombre, apellido, email, estado, id_curso } = req.body

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`
      UPDATE alumno
      SET nombre=COALESCE($2,nombre),
          apellido=COALESCE($3,apellido),
          email=COALESCE($4,email),
          estado=COALESCE($5,estado)
      WHERE dni=$1
      RETURNING *
    `, [dni, nombre, apellido, email, estado])

    if (!rows[0]) {
      await client.query('ROLLBACK')
      return fail(res, 404, 'Alumno no encontrado')
    }
    if (id_curso !== undefined) {
      const currentCycle = await client.query(
        'SELECT id_ciclo_lectivo FROM ciclo_lectivo ORDER BY anio DESC LIMIT 1',
      )
      if (currentCycle.rows[0]) {
        if (id_curso) {
          await client.query(`
            UPDATE alumno_curso
            SET fecha_baja=CURRENT_DATE
            WHERE dni_alumno=$1
              AND id_ciclo_lectivo=$2
              AND fecha_baja IS NULL
              AND id_curso<>$3
          `, [dni, id_curso, currentCycle.rows[0].id_ciclo_lectivo])
          await client.query(`
            INSERT INTO alumno_curso (dni_alumno, id_curso, id_ciclo_lectivo)
            SELECT $1,$2,$3
            WHERE NOT EXISTS (
              SELECT 1 FROM alumno_curso
              WHERE dni_alumno=$1 AND id_curso=$2 AND id_ciclo_lectivo=$3
                AND fecha_baja IS NULL
            )
          `, [dni, id_curso, currentCycle.rows[0].id_ciclo_lectivo])
        } else {
          await client.query(`
            UPDATE alumno_curso SET fecha_baja=CURRENT_DATE
            WHERE dni_alumno=$1 AND id_ciclo_lectivo=$2
              AND fecha_baja IS NULL
          `, [dni, currentCycle.rows[0].id_ciclo_lectivo])
        }
      }
    }
    await client.query('COMMIT')
    res.json(rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    console.error(error)
    fail(res, 400, 'No se pudo modificar el alumno')
  } finally {
    client.release()
  }
})

app.get('/api/docentes', auth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.dni, p.nombre, p.apellido, p.email, p.telefono,
             COALESCE(string_agg(DISTINCT m.nombre, ', '), '') AS materias,
              COALESCE(string_agg(DISTINCT c.anio || '° ' || c.division || ' ' || e.nombre, ', '), '') AS cursos
      FROM profesor p
      LEFT JOIN profesor_curso_materia pcm ON pcm.dni_profesor=p.dni
        AND pcm.id_ciclo_lectivo=(
          SELECT id_ciclo_lectivo FROM ciclo_lectivo ORDER BY anio DESC LIMIT 1
        )
      LEFT JOIN materia m ON m.codigo=pcm.codigo_materia
      LEFT JOIN curso c ON c.id_curso=pcm.id_curso
      LEFT JOIN especialidad e ON e.id_especialidad=c.id_especialidad
      GROUP BY p.dni
      ORDER BY p.apellido, p.nombre
    `)
    res.json(rows)
  } catch (error) {
    console.error(error)
    fail(res, 500, 'No se pudieron obtener los docentes')
  }
})

app.get('/api/cursos', auth, async (req, res) => {
  try {
    const cicloLectivo = Number(req.query.ciclo_lectivo) || null
    const { rows } = await pool.query(`
      SELECT c.*,
             COUNT(a.dni)::int AS cantidad_alumnos,
         cl.anio AS ciclo_lectivo,
             e.nombre AS especialidad,
         t.id_turno AS turno_id,
             t.jornada AS turno
      FROM curso c
      JOIN especialidad e ON e.id_especialidad=c.id_especialidad
      JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=c.id_ciclo_lectivo
      LEFT JOIN alumno_curso ac ON ac.id_curso=c.id_curso
        AND ac.id_ciclo_lectivo=c.id_ciclo_lectivo
        AND ac.fecha_baja IS NULL
      LEFT JOIN alumno a ON a.dni=ac.dni_alumno AND a.estado='Activo'
      LEFT JOIN curso_turno ct ON ct.id_curso=c.id_curso
      LEFT JOIN turno t ON t.id_turno=ct.id_turno
      GROUP BY c.id_curso, cl.anio, e.nombre, t.id_turno, t.jornada
      HAVING cl.anio=COALESCE($1::integer, (SELECT MAX(anio) FROM ciclo_lectivo))
      ORDER BY c.anio, c.division
    `, [cicloLectivo])
    res.json(rows)
  } catch (error) {
    console.error(error)
    fail(res, 500, 'No se pudieron obtener los cursos')
  }
})

app.post('/api/cursos', auth, roles('admin'), async (req, res) => {
  const anio = Number(req.body.anio)
  const { especialidad } = req.body
  const turnoId = req.body.turno_id == null || req.body.turno_id === ''
    ? null
    : Number(req.body.turno_id)

  if (!Number.isInteger(anio) || anio < 1 || anio > 6) {
    return fail(res, 400, 'El año debe estar entre 1 y 6')
  }
  if (!['Automotores', 'Computación'].includes(especialidad)) {
    return fail(res, 400, 'La especialidad no es válida')
  }
  if (turnoId !== null && !Number.isInteger(turnoId)) {
    return fail(res, 400, 'El turno no es válido')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const specialtyResult = await client.query(
      'SELECT id_especialidad FROM especialidad WHERE nombre=$1',
      [especialidad],
    )
    const cycleResult = await client.query(
      'SELECT id_ciclo_lectivo FROM ciclo_lectivo ORDER BY anio DESC LIMIT 1',
    )
    if (!cycleResult.rows[0]) {
      await client.query('ROLLBACK')
      return fail(res, 400, 'No hay un ciclo lectivo configurado')
    }

    const { rows } = await client.query(`
      INSERT INTO curso (anio, division, id_ciclo_lectivo, id_especialidad)
      VALUES ($1,'1',$2,$3)
      RETURNING *
    `, [anio, cycleResult.rows[0].id_ciclo_lectivo, specialtyResult.rows[0]?.id_especialidad])

    if (turnoId !== null) {
      await client.query(
        'INSERT INTO curso_turno (id_curso, id_turno) VALUES ($1,$2)',
        [rows[0].id_curso, turnoId],
      )
    }
    await client.query('COMMIT')
    res.status(201).json({ ...rows[0], especialidad, turno_id: turnoId })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505') return fail(res, 409, 'Ya existe ese curso en el ciclo lectivo actual')
    if (error.code === '23503') return fail(res, 400, 'El turno o la especialidad no existen')
    console.error(error)
    fail(res, 400, 'No se pudo crear el curso')
  } finally {
    client.release()
  }
})

app.put('/api/cursos/:id', auth, roles('admin'), async (req, res) => {
  const idCurso = Number(req.params.id)
  const anio = Number(req.body.anio)
  const { especialidad } = req.body
  const turnoId = req.body.turno_id == null || req.body.turno_id === ''
    ? null
    : Number(req.body.turno_id)

  if (!Number.isInteger(idCurso) || !Number.isInteger(anio) || anio < 1 || anio > 6) {
    return fail(res, 400, 'El curso o el año no son válidos')
  }
  if (!['Automotores', 'Computación'].includes(especialidad)) {
    return fail(res, 400, 'La especialidad no es válida')
  }
  if (turnoId !== null && !Number.isInteger(turnoId)) {
    return fail(res, 400, 'El turno no es válido')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const specialtyResult = await client.query(
      'SELECT id_especialidad FROM especialidad WHERE nombre=$1',
      [especialidad],
    )
    const cycleResult = await client.query(
      'SELECT id_ciclo_lectivo FROM ciclo_lectivo ORDER BY anio DESC LIMIT 1',
    )
    if (!cycleResult.rows[0]) {
      await client.query('ROLLBACK')
      return fail(res, 400, 'No hay un ciclo lectivo configurado')
    }

    const { rows } = await client.query(`
      UPDATE curso
      SET anio=$2, division='1', id_especialidad=$3
      WHERE id_curso=$1 AND id_ciclo_lectivo=$4
      RETURNING *
    `, [idCurso, anio, specialtyResult.rows[0]?.id_especialidad, cycleResult.rows[0].id_ciclo_lectivo])
    if (!rows[0]) {
      await client.query('ROLLBACK')
      return fail(res, 404, 'Curso no encontrado en el ciclo lectivo actual')
    }

    if (turnoId === null) {
      await client.query('DELETE FROM curso_turno WHERE id_curso=$1', [idCurso])
    } else {
      await client.query(`
        INSERT INTO curso_turno (id_curso, id_turno)
        VALUES ($1,$2)
        ON CONFLICT (id_curso) DO UPDATE SET id_turno=EXCLUDED.id_turno
      `, [idCurso, turnoId])
    }
    await client.query('COMMIT')
    res.json({ ...rows[0], especialidad, turno_id: turnoId })
  } catch (error) {
    await client.query('ROLLBACK')
    if (error.code === '23505') return fail(res, 409, 'Ya existe ese curso en el ciclo lectivo actual')
    if (error.code === '23503') return fail(res, 400, 'El turno o la especialidad no existen')
    console.error(error)
    fail(res, 400, 'No se pudo modificar el curso')
  } finally {
    client.release()
  }
})

app.delete('/api/cursos/:id', auth, roles('admin'), async (req, res) => {
  const idCurso = Number(req.params.id)
  if (!Number.isInteger(idCurso)) return fail(res, 400, 'El curso no es válido')

  try {
    const { rows } = await pool.query(`
      DELETE FROM curso
      WHERE id_curso=$1
        AND id_ciclo_lectivo=(SELECT id_ciclo_lectivo FROM ciclo_lectivo ORDER BY anio DESC LIMIT 1)
      RETURNING id_curso
    `, [idCurso])
    if (!rows[0]) return fail(res, 404, 'Curso no encontrado en el ciclo lectivo actual')
    res.json({ ok: true })
  } catch (error) {
    if (error.code === '23503') {
      return fail(res, 409, 'No se puede eliminar un curso con alumnos o notas asociadas')
    }
    console.error(error)
    fail(res, 400, 'No se pudo eliminar el curso')
  }
})

app.get('/api/ciclos-lectivos', auth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id_ciclo_lectivo, anio
      FROM ciclo_lectivo
      ORDER BY anio DESC
    `)
    res.json(rows)
  } catch (error) {
    console.error(error)
    fail(res, 500, 'No se pudieron obtener los ciclos lectivos')
  }
})

app.get('/api/turnos', auth, roles('admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id_turno, jornada, entrada_prehora, hora_inicio, hora_fin, salida_poshora
      FROM turno
      ORDER BY CASE jornada
        WHEN 'Mañana' THEN 1
        WHEN 'Tarde' THEN 2
        WHEN 'Noche' THEN 3
        ELSE 4
      END, jornada
    `)
    res.json(rows)
  } catch (error) {
    console.error(error)
    fail(res, 500, 'No se pudieron obtener los turnos')
  }
})

app.get('/api/materias', auth, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM materia ORDER BY nombre')
    res.json(rows)
  } catch (error) {
    console.error(error)
    fail(res, 500, 'No se pudieron obtener las materias')
  }
})

app.get('/api/notas', auth, async (req, res) => {
  try {
    const { curso, materia } = req.query
    const cicloLectivo = Number(req.query.ciclo_lectivo) || null
    const params = [cicloLectivo]
    let where = 'cl.anio = COALESCE($1::integer, (SELECT MAX(anio) FROM ciclo_lectivo))'

    if (curso) {
      params.push(curso)
      where += ` AND ac.id_curso=$${params.length}`
    }
    if (materia) {
      params.push(materia)
      where += ` AND n.codigo_materia=$${params.length}`
    }

    const { rows } = await pool.query(`
      SELECT a.dni, a.nombre, a.apellido,
             c.anio, c.division,
              cl.anio AS ciclo_lectivo,
             n.codigo_materia, m.nombre AS materia,
             n.tipo_evaluacion, n.calificacion, n.fecha,
             n.observacion, n.dni_profesor
      FROM alumno a
            JOIN alumno_curso ac ON ac.dni_alumno=a.dni
            JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=ac.id_ciclo_lectivo
            JOIN curso c ON c.id_curso=ac.id_curso
            LEFT JOIN nota n ON n.dni_alumno=a.dni
         AND n.id_ciclo_lectivo=ac.id_ciclo_lectivo
         AND n.id_curso=ac.id_curso
      LEFT JOIN materia m ON m.codigo=n.codigo_materia
      WHERE ${where}
      ORDER BY a.apellido, a.nombre, n.tipo_evaluacion
    `, params)

    res.json(rows)
  } catch (error) {
    console.error(error)
    fail(res, 500, 'No se pudieron obtener las notas')
  }
})

app.post('/api/notas', auth, roles('admin', 'profesor', 'preceptor'), async (req, res) => {
  const {
    dni_alumno,
    codigo_materia,
    tipo_evaluacion,
    calificacion,
    observacion,
    fecha,
    ciclo_lectivo,
  } = req.body

  if (!dni_alumno || !codigo_materia || !tipo_evaluacion || calificacion == null) {
    return fail(res, 400, 'Faltan datos de la nota')
  }
  if (Number(calificacion) < 1 || Number(calificacion) > 10) {
    return fail(res, 400, 'La calificación debe estar entre 1 y 10')
  }

  try {
    const dniProfesor = req.user.dni_profesor || null
    const enrollment = await pool.query(`
      SELECT ac.id_curso, ac.id_ciclo_lectivo
      FROM alumno_curso ac
      JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=ac.id_ciclo_lectivo
      WHERE ac.dni_alumno=$1
        AND ac.fecha_baja IS NULL
        AND cl.anio=COALESCE($2::integer, (SELECT MAX(anio) FROM ciclo_lectivo))
      LIMIT 1
    `, [dni_alumno, Number(ciclo_lectivo) || null])
    if (!enrollment.rows[0]) {
      return fail(res, 400, 'El alumno no tiene curso asignado en ese ciclo lectivo')
    }
    const { id_curso, id_ciclo_lectivo } = enrollment.rows[0]
    const { rows } = await pool.query(`
      INSERT INTO nota
        (dni_alumno,id_curso,id_ciclo_lectivo,codigo_materia,tipo_evaluacion,calificacion,observacion,fecha,dni_profesor)
      VALUES ($1,$8,$9,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7)
      ON CONFLICT (dni_alumno,codigo_materia,tipo_evaluacion,id_ciclo_lectivo)
      DO UPDATE SET
        id_curso=EXCLUDED.id_curso,
        calificacion=EXCLUDED.calificacion,
        observacion=EXCLUDED.observacion,
        fecha=EXCLUDED.fecha,
        dni_profesor=EXCLUDED.dni_profesor
      RETURNING *
    `, [
      dni_alumno,
      codigo_materia,
      tipo_evaluacion,
      calificacion,
      observacion || null,
      fecha || null,
      dniProfesor,
      id_curso,
      id_ciclo_lectivo,
    ])

    res.status(201).json(rows[0])
  } catch (error) {
    console.error(error)
    fail(res, 400, 'No se pudo guardar la nota')
  }
})

app.get('/api/mis-notas', auth, roles('alumno'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.codigo, m.nombre AS materia,
             MAX(n.calificacion) FILTER (WHERE n.tipo_evaluacion='BIMESTRE_1') AS bim1,
             MAX(n.calificacion) FILTER (WHERE n.tipo_evaluacion='BIMESTRE_2') AS bim2,
             MAX(n.calificacion) FILTER (WHERE n.tipo_evaluacion='CUATRIMESTRE_1') AS cuat1,
             MAX(n.calificacion) FILTER (WHERE n.tipo_evaluacion='FINAL') AS final
      FROM materia m
      JOIN nota n ON n.codigo_materia=m.codigo
      JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=n.id_ciclo_lectivo
      WHERE n.dni_alumno=$1
        AND cl.anio=(SELECT MAX(anio) FROM ciclo_lectivo)
      GROUP BY m.codigo, m.nombre
      ORDER BY m.nombre
    `, [req.user.dni_alumno])
    res.json(rows)
  } catch (error) {
    console.error(error)
    fail(res, 500, 'No se pudieron obtener tus calificaciones')
  }
})

app.get('/api/notificaciones', auth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT n.id_nota, a.nombre, a.apellido, m.nombre AS materia,
             n.calificacion, n.tipo_evaluacion, n.fecha,
             CASE WHEN n.calificacion < 6 THEN 'Crítica' ELSE 'Informe' END AS tipo
      FROM nota n
      JOIN alumno a ON a.dni=n.dni_alumno
      JOIN materia m ON m.codigo=n.codigo_materia
      JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=n.id_ciclo_lectivo
      WHERE cl.anio=(SELECT MAX(anio) FROM ciclo_lectivo)
      ORDER BY n.fecha DESC, n.id_nota DESC
      LIMIT 30
    `)
    res.json(rows)
  } catch (error) {
    console.error(error)
    fail(res, 500, 'No se pudieron obtener las notificaciones')
  }
})

async function ensureRole(name, description) {
  await pool.query(
    'INSERT INTO rol(nombre, descripcion) VALUES($1,$2) ON CONFLICT(nombre) DO NOTHING',
    [name, description],
  )
}

async function ensureDemoUsers() {
  await ensureRole('admin', 'Autoridad / Administrador')
  await ensureRole('profesor', 'Profesor / Docente')
  await ensureRole('alumno', 'Alumno')
  await ensureRole('preceptor', 'Preceptor')

  const password = await bcrypt.hash('1234', 10)
  const rolesResult = await pool.query('SELECT id_rol, nombre FROM rol')
  const roleId = Object.fromEntries(rolesResult.rows.map((r) => [r.nombre, r.id_rol]))

  await pool.query(`
    INSERT INTO usuario(nombre_usuario, contrasenia, estado, id_rol)
    VALUES ('admin',$1,'Activo',$2)
    ON CONFLICT(nombre_usuario) DO NOTHING
  `, [password, roleId.admin])

  await pool.query(`
    INSERT INTO usuario(nombre_usuario, contrasenia, estado, dni_profesor, id_rol)
    VALUES ('31928371',$1,'Activo','31928371',$2)
    ON CONFLICT(nombre_usuario) DO NOTHING
  `, [password, roleId.profesor])

  await pool.query(`
    INSERT INTO usuario(nombre_usuario, contrasenia, estado, dni_alumno, id_rol)
    VALUES ('96103383',$1,'Activo','96103383',$2)
    ON CONFLICT(nombre_usuario) DO NOTHING
  `, [password, roleId.alumno])

  await pool.query(`
    INSERT INTO usuario(nombre_usuario, contrasenia, estado, id_rol)
    VALUES ('preceptor',$1,'Activo',$2)
    ON CONFLICT(nombre_usuario) DO NOTHING
  `, [password, roleId.preceptor])

  if (roleId.profesor) {
    await pool.query(`
      INSERT INTO profesor_rol(dni_profesor,id_rol)
      VALUES ('31928371',$1)
      ON CONFLICT DO NOTHING
    `, [roleId.profesor])
  }

  await pool.query(`
  UPDATE usuario
  SET id_rol = $1
  WHERE nombre_usuario = 'admin'
`, [roleId.admin])

await pool.query(`
  UPDATE usuario
  SET id_rol = $1
  WHERE nombre_usuario = '31928371'
`, [roleId.profesor])

await pool.query(`
  UPDATE usuario
  SET id_rol = $1
  WHERE nombre_usuario = '96103383'
`, [roleId.alumno])

await pool.query(`
  UPDATE usuario
  SET id_rol = $1
  WHERE nombre_usuario = 'preceptor'
`, [roleId.preceptor])
}

const distPath = path.join(__dirname, 'dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

async function start() {
  try {
    await pool.query('SELECT 1')
    await ensureDemoUsers()
    app.listen(PORT, () => {
      console.log(`Backend ejecutándose en http://localhost:${PORT}`)
      if (fs.existsSync(distPath)) {
        console.log(`Frontend compilado disponible en http://localhost:${PORT}`)
      }
    })
  } catch (error) {
    console.error('No se pudo iniciar el backend:', error.message)
    process.exit(1)
  }
}

start()
