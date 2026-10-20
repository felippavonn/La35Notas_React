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
app.use(cors())
app.use(express.json())

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'gestion_notas',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
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
    const alumnos = await pool.query(`SELECT COUNT(*)::int AS total FROM alumno WHERE estado='Activo'`)
    const aprobados = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT dni_alumno
        FROM nota
        GROUP BY dni_alumno, codigo_materia
        HAVING AVG(calificacion) >= 6
      ) x
    `)
    const incompletos = await pool.query(`
      SELECT COUNT(*)::int AS total
      FROM nota
      WHERE observacion IS NOT NULL AND BTRIM(observacion) <> ''
    `).catch(() => ({ rows: [{ total: 0 }] }))

    res.json({
      alumnos_activos: alumnos.rows[0].total,
      aprobados: aprobados.rows[0].total,
      contenidos_incompletos: incompletos.rows[0].total,
    })
  } catch (error) {
    console.error(error)
    fail(res, 500, 'No se pudo obtener el panel')
  }
})

app.get('/api/alumnos', auth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.dni, a.nombre, a.apellido, a.email, a.estado,
             c.id_curso, c.anio, c.division, c.ciclo_lectivo,
             COALESCE(ROUND(AVG(n.calificacion), 1), 0) AS promedio
      FROM alumno a
      LEFT JOIN curso c ON c.id_curso = a.id_curso
      LEFT JOIN nota n ON n.dni_alumno = a.dni
      GROUP BY a.dni, c.id_curso
      ORDER BY a.apellido, a.nombre
    `)
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

  try {
    const { rows } = await pool.query(`
      INSERT INTO alumno (dni, nombre, apellido, email, estado, id_curso)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `, [dni, nombre, apellido, email || null, estado, id_curso || null])
    res.status(201).json(rows[0])
  } catch (error) {
    console.error(error)
    if (error.code === '23505') return fail(res, 409, 'Ya existe un alumno con ese DNI')
    fail(res, 400, 'No se pudo crear el alumno')
  }
})

app.put('/api/alumnos/:dni', auth, roles('admin', 'preceptor'), async (req, res) => {
  const { dni } = req.params
  const { nombre, apellido, email, estado, id_curso } = req.body

  try {
    const { rows } = await pool.query(`
      UPDATE alumno
      SET nombre=COALESCE($2,nombre),
          apellido=COALESCE($3,apellido),
          email=COALESCE($4,email),
          estado=COALESCE($5,estado),
          id_curso=COALESCE($6,id_curso)
      WHERE dni=$1
      RETURNING *
    `, [dni, nombre, apellido, email, estado, id_curso])

    if (!rows[0]) return fail(res, 404, 'Alumno no encontrado')
    res.json(rows[0])
  } catch (error) {
    console.error(error)
    fail(res, 400, 'No se pudo modificar el alumno')
  }
})

app.get('/api/docentes', auth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.dni, p.nombre, p.apellido, p.email, p.telefono,
             COALESCE(string_agg(DISTINCT m.nombre, ', '), '') AS materias,
             COALESCE(string_agg(DISTINCT c.anio || '° ' || c.division, ', '), '') AS cursos
      FROM profesor p
      LEFT JOIN profesor_curso_materia pcm ON pcm.dni_profesor=p.dni
      LEFT JOIN materia m ON m.codigo=pcm.codigo_materia
      LEFT JOIN curso c ON c.id_curso=pcm.id_curso
      GROUP BY p.dni
      ORDER BY p.apellido, p.nombre
    `)
    res.json(rows)
  } catch (error) {
    console.error(error)
    fail(res, 500, 'No se pudieron obtener los docentes')
  }
})

app.get('/api/cursos', auth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, t.jornada,
             COUNT(a.dni)::int AS cantidad_alumnos
      FROM curso c
      LEFT JOIN turno t ON t.id_turno=c.id_turno
      LEFT JOIN alumno a ON a.id_curso=c.id_curso AND a.estado='Activo'
      GROUP BY c.id_curso, t.jornada
      ORDER BY c.anio, c.division
    `)
    res.json(rows)
  } catch (error) {
    console.error(error)
    fail(res, 500, 'No se pudieron obtener los cursos')
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
    const params = []
    let where = '1=1'

    if (curso) {
      params.push(curso)
      where += ` AND a.id_curso=$${params.length}`
    }
    if (materia) {
      params.push(materia)
      where += ` AND n.codigo_materia=$${params.length}`
    }

    const { rows } = await pool.query(`
      SELECT a.dni, a.nombre, a.apellido,
             c.anio, c.division,
             n.codigo_materia, m.nombre AS materia,
             n.tipo_evaluacion, n.calificacion, n.fecha,
             n.observacion, n.dni_profesor
      FROM alumno a
      LEFT JOIN curso c ON c.id_curso=a.id_curso
      LEFT JOIN nota n ON n.dni_alumno=a.dni
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
  } = req.body

  if (!dni_alumno || !codigo_materia || !tipo_evaluacion || calificacion == null) {
    return fail(res, 400, 'Faltan datos de la nota')
  }
  if (Number(calificacion) < 1 || Number(calificacion) > 10) {
    return fail(res, 400, 'La calificación debe estar entre 1 y 10')
  }

  try {
    const dniProfesor = req.user.dni_profesor || null
    const { rows } = await pool.query(`
      INSERT INTO nota
        (dni_alumno,codigo_materia,tipo_evaluacion,calificacion,observacion,fecha,dni_profesor)
      VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7)
      ON CONFLICT (dni_alumno,codigo_materia,tipo_evaluacion)
      DO UPDATE SET
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
      WHERE n.dni_alumno=$1
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
