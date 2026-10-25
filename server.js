import "dotenv/config";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const configuredCorsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigins = configuredCorsOrigins.length
  ? configuredCorsOrigins
  : isProduction
    ? []
    : ["http://localhost:5173"];

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL es obligatorio para iniciar el servidor");
}
if (isProduction && corsOrigins.length === 0) {
  throw new Error(
    "CORS_ORIGIN debe incluir el dominio de la interfaz en producción",
  );
}

app.use(
  cors({
    origin: corsOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "1mb" }));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : undefined,
});

const PORT = Number(process.env.PORT || 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT debe ser un puerto válido");
}
const tokens = new Map();
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const tokenCleanup = setInterval(
  () => {
    const now = Date.now();
    for (const [token, session] of tokens) {
      if (session.expiresAt <= now) tokens.delete(token);
    }
  },
  15 * 60 * 1000,
);
tokenCleanup.unref();

async function ensurePersonAccount(client, dni, role, dniColumn) {
  const roleResult = await client.query(
    "SELECT id_rol FROM rol WHERE nombre=$1",
    [role],
  );
  if (!roleResult.rows[0]) throw new Error(`No se encontró el rol ${role}`);
  const passwordHash = await bcrypt.hash(String(dni), 10);
  const { rows } = await client.query(
    `
    INSERT INTO usuario (nombre_usuario, contrasenia, estado, ${dniColumn}, id_rol)
    VALUES ($1,$2,'Activo',$1,$3)
    RETURNING id_usuario
  `,
    [dni, passwordHash, roleResult.rows[0].id_rol],
  );
  if (!rows[0]) throw new Error(`No se pudo crear la cuenta para ${dni}`);
}

async function syncPersonAccount(client, dni, role, dniColumn, isActive) {
  if (isActive) {
    const { rows } = await client.query(
      `UPDATE usuario SET estado='Activo' WHERE ${dniColumn}=$1 RETURNING id_usuario`,
      [dni],
    );
    if (rows[0]) return { userId: rows[0].id_usuario, isActive: true };

    await ensurePersonAccount(client, dni, role, dniColumn);
    const { rows: accountRows } = await client.query(
      `SELECT id_usuario FROM usuario WHERE ${dniColumn}=$1`,
      [dni],
    );
    return { userId: accountRows[0]?.id_usuario || null, isActive: true };
  }

  const { rows } = await client.query(
    `UPDATE usuario SET estado='Baja' WHERE ${dniColumn}=$1 RETURNING id_usuario`,
    [dni],
  );
  return { userId: rows[0]?.id_usuario || null, isActive: false };
}

function revokeAccountSessions(userId) {
  if (!userId) return;
  for (const [token, session] of tokens) {
    if (session.user.id_usuario === userId) tokens.delete(token);
  }
}

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

function requestedCycleYear(req) {
  const year = Number(req.query.ciclo_lectivo);
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null;
}

async function getCycleId(db, year) {
  const { rows } = await db.query(
    `
    SELECT id_ciclo_lectivo
    FROM ciclo_lectivo
    WHERE ($1::integer IS NULL OR anio=$1)
    ORDER BY anio DESC
    LIMIT 1
  `,
    [year],
  );
  return rows[0]?.id_ciclo_lectivo || null;
}

async function getUserByLogin(login) {
  const { rows } = await pool.query(
    `
    SELECT u.*, r.nombre AS rol,
           a.nombre AS alumno_nombre, a.apellido AS alumno_apellido,
           p.nombre AS profesor_nombre, p.apellido AS profesor_apellido,
           prec.nombre AS preceptor_nombre, prec.apellido AS preceptor_apellido,
           adm.nombre AS administrador_nombre, adm.apellido AS administrador_apellido
    FROM usuario u
    LEFT JOIN rol r ON r.id_rol = u.id_rol
    LEFT JOIN alumno a ON a.dni = u.dni_alumno
    LEFT JOIN profesor p ON p.dni = u.dni_profesor
    LEFT JOIN preceptor prec ON prec.dni=u.dni_preceptor
    LEFT JOIN administrador adm ON adm.dni=u.dni_administrador
    WHERE u.nombre_usuario = $1
       OR u.dni_alumno = $1
       OR u.dni_profesor = $1
       OR u.dni_preceptor = $1
       OR u.dni_administrador = $1
    LIMIT 1
  `,
    [login],
  );
  return rows[0];
}

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const session = token ? tokens.get(token) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (token) tokens.delete(token);
    return fail(res, 401, "No autenticado");
  }
  req.user = session.user;
  next();
}

function roles(...allowed) {
  return (req, res, next) => {
    if (!req.user || !req.user.rol) {
      return fail(res, 403, "El usuario no tiene un rol asignado");
    }

    if (!allowed.includes(req.user.rol)) {
      return fail(res, 403, "No tenés permisos para esta operación");
    }

    next();
  };
}

async function replaceCourseSubjects(client, courseId, cycleId, subjectCodes) {
  if (
    !Array.isArray(subjectCodes) ||
    subjectCodes.some((code) => typeof code !== "string")
  ) {
    throw new Error("La lista de materias no es válida");
  }
  const uniqueCodes = [...new Set(subjectCodes)];
  if (uniqueCodes.length) {
    const { rows } = await client.query(
      "SELECT COUNT(*)::int AS count FROM ciclo_materia WHERE id_ciclo_lectivo=$1 AND codigo_materia=ANY($2::varchar[])",
      [cycleId, uniqueCodes],
    );
    if (rows[0].count !== uniqueCodes.length)
      throw new Error("Una o más materias no existen");
  }

  await client.query(
    `
    DELETE FROM curso_materia
    WHERE id_curso=$1
      AND id_ciclo_lectivo=$2
      AND NOT (codigo_materia=ANY($3::varchar[]))
  `,
    [courseId, cycleId, uniqueCodes],
  );
  if (uniqueCodes.length) {
    await client.query(
      `
      INSERT INTO curso_materia (id_curso, codigo_materia, id_ciclo_lectivo)
      SELECT $1, codigo, $3 FROM UNNEST($2::varchar[]) AS subjects(codigo)
      ON CONFLICT (id_curso, codigo_materia, id_ciclo_lectivo) DO NOTHING
    `,
      [courseId, uniqueCodes, cycleId],
    );
  }
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, servicio: "gestion-notas" });
  } catch {
    res
      .status(500)
      .json({ ok: false, error: "No se pudo conectar a PostgreSQL" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { usuario, contrasenia } = req.body;
    if (!usuario || !contrasenia)
      return fail(res, 400, "Faltan usuario y contraseña");
    if (!/^\d+$/.test(String(usuario)))
      return fail(res, 400, "Ingresá un DNI válido");

    const user = await getUserByLogin(usuario);
    if (!user || user.estado !== "Activo") {
      return fail(res, 401, "Usuario o contraseña incorrectos");
    }

    const ok = await bcrypt.compare(contrasenia, user.contrasenia);
    if (!ok) return fail(res, 401, "Usuario o contraseña incorrectos");

    const token = crypto.randomBytes(32).toString("hex");
    const session = {
      id_usuario: user.id_usuario,
      rol: user.rol,
      dni_alumno: user.dni_alumno,
      dni_profesor: user.dni_profesor,
      dni_preceptor: user.dni_preceptor,
      dni_administrador: user.dni_administrador,
      nombre: user.alumno_nombre
        ? `${user.alumno_apellido}, ${user.alumno_nombre}`
        : user.profesor_nombre
          ? `${user.profesor_apellido}, ${user.profesor_nombre}`
          : user.preceptor_nombre
            ? `${user.preceptor_apellido}, ${user.preceptor_nombre}`
            : user.administrador_nombre
              ? `${user.administrador_apellido}, ${user.administrador_nombre}`
              : user.nombre_usuario,
    };

    tokens.set(token, {
      user: session,
      expiresAt: Date.now() + SESSION_DURATION_MS,
    });
    await pool.query(
      "UPDATE usuario SET ultimo_acceso = NOW() WHERE id_usuario = $1",
      [user.id_usuario],
    );
    res.json({ token, usuario: session });
  } catch (error) {
    console.error(error);
    fail(res, 500, "Error interno");
  }
});

app.post("/api/logout", auth, (req, res) => {
  const token = (req.headers.authorization || "").slice(7);
  tokens.delete(token);
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => res.json(req.user));

app.get("/api/dashboard", auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      WITH ciclo_actual AS (
        SELECT id_ciclo_lectivo
        FROM ciclo_lectivo
        WHERE anio=COALESCE($1::integer, (SELECT MAX(anio) FROM ciclo_lectivo))
        ORDER BY anio DESC
        LIMIT 1
      )
      SELECT
        (SELECT COUNT(DISTINCT a.dni)::int
         FROM alumno a
         JOIN alumno_curso ac ON ac.dni_alumno=a.dni
         JOIN ciclo_actual ca ON ca.id_ciclo_lectivo=ac.id_ciclo_lectivo
         WHERE a.estado='Activo' AND ac.fecha_baja IS NULL) AS alumnos_activos,
        (SELECT COUNT(*)::int
         FROM nota n
         JOIN ciclo_actual ca ON ca.id_ciclo_lectivo=n.id_ciclo_lectivo) AS calificaciones_cargadas
    `,
      [requestedCycleYear(req)],
    );
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudo obtener el panel");
  }
});

app.get("/api/alumnos", auth, async (req, res) => {
  try {
    const cicloLectivo = Number(req.query.ciclo_lectivo) || null;
    const { rows } = await pool.query(
      `
      SELECT a.dni, a.nombre, a.apellido, a.email, a.estado,
             c.id_curso, c.anio, c.division, e.nombre AS especialidad, cl.anio AS ciclo_lectivo,
             COALESCE(ROUND(AVG(n.calificacion), 2), 0) AS promedio,
             ROUND(AVG(n.calificacion), 2) AS promedio_anio,
             (SELECT ROUND(AVG(nota_general.calificacion), 2)
              FROM nota nota_general
              WHERE nota_general.dni_alumno=a.dni) AS promedio_general
      FROM alumno a
      LEFT JOIN LATERAL (
        SELECT ac.*
        FROM alumno_curso ac
        WHERE ac.dni_alumno=a.dni
          AND ac.fecha_baja IS NULL
          AND ac.id_ciclo_lectivo=(
            SELECT id_ciclo_lectivo FROM ciclo_lectivo
            WHERE ($1::integer IS NULL OR anio=$1)
            ORDER BY anio DESC LIMIT 1
          )
        ORDER BY ac.fecha_inscripcion DESC, ac.fecha_baja NULLS FIRST
        LIMIT 1
      ) ac ON TRUE
      LEFT JOIN curso c ON c.id_curso = ac.id_curso
      LEFT JOIN especialidad e ON e.id_especialidad = c.id_especialidad
      LEFT JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo = ac.id_ciclo_lectivo
      LEFT JOIN nota n ON n.dni_alumno = a.dni
        AND n.id_ciclo_lectivo = ac.id_ciclo_lectivo
        AND n.id_curso = ac.id_curso
      GROUP BY a.dni, c.id_curso, e.nombre, cl.anio
      ORDER BY a.apellido, a.nombre
    `,
      [cicloLectivo],
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener los alumnos");
  }
});

async function getStudentBulletins(dni, cycleYear = null) {
  const { rows } = await pool.query(
    `
    WITH current_enrollment AS (
      SELECT DISTINCT ON (ac.dni_alumno, ac.id_ciclo_lectivo) ac.*
      FROM alumno_curso ac
      WHERE ac.dni_alumno=$1
      ORDER BY ac.dni_alumno, ac.id_ciclo_lectivo,
               (ac.fecha_baja IS NULL) DESC,
               ac.fecha_inscripcion DESC,
               ac.id_curso DESC
    )
    SELECT a.dni, a.nombre, a.apellido, a.fecha_nacimiento,
           a.genero, a.nacionalidad,
           d.calle, d.numero_calle, d.departamento, d.localidad,
           ac.id_curso,
           cl.anio AS ciclo_lectivo, c.anio AS anio_curso, c.division,
           e.nombre AS especialidad, t.jornada AS turno,
           subjects.codigo_materia,
           cm.nombre AS materia,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', n.id_nota,
               'tipo_evaluacion', n.tipo_evaluacion,
               'calificacion', n.calificacion,
               'fecha', n.fecha,
               'observacion', n.observacion
             ) ORDER BY n.fecha DESC, n.id_nota DESC)
             FROM nota n
             WHERE n.dni_alumno=ac.dni_alumno
               AND n.id_curso=ac.id_curso
               AND n.id_ciclo_lectivo=ac.id_ciclo_lectivo
               AND n.codigo_materia=subjects.codigo_materia
           ), '[]'::jsonb) AS notas,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', ni.id_nota_individual,
               'tipo_evaluacion', ni.tipo_evaluacion,
               'tema', ni.tema,
               'estado', ni.estado,
               'calificacion', ni.calificacion,
               'adeuda', ni.adeuda,
               'fecha', ni.fecha
             ) ORDER BY ni.fecha, ni.id_nota_individual)
             FROM nota_individual ni
             WHERE ni.dni_alumno=ac.dni_alumno
               AND ni.id_curso=ac.id_curso
               AND ni.id_ciclo_lectivo=ac.id_ciclo_lectivo
               AND ni.codigo_materia=subjects.codigo_materia
           ), '[]'::jsonb) AS evaluaciones
    FROM current_enrollment ac
    JOIN alumno a ON a.dni=ac.dni_alumno
    LEFT JOIN domicilio d ON d.id_domicilio=a.id_domicilio
    JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=ac.id_ciclo_lectivo
    JOIN curso c ON c.id_curso=ac.id_curso
      AND c.id_ciclo_lectivo=ac.id_ciclo_lectivo
    LEFT JOIN especialidad e ON e.id_especialidad=c.id_especialidad
    LEFT JOIN curso_turno ct ON ct.id_curso=c.id_curso
    LEFT JOIN turno t ON t.id_turno=ct.id_turno
    LEFT JOIN LATERAL (
      SELECT codigo_materia
      FROM curso_materia
      WHERE id_curso=ac.id_curso AND id_ciclo_lectivo=ac.id_ciclo_lectivo
      UNION
      SELECT codigo_materia
      FROM nota
      WHERE dni_alumno=ac.dni_alumno AND id_curso=ac.id_curso
        AND id_ciclo_lectivo=ac.id_ciclo_lectivo
    ) subjects ON TRUE
    LEFT JOIN materia cm ON cm.codigo=subjects.codigo_materia
    WHERE ac.dni_alumno=$1
      AND ($2::integer IS NULL OR cl.anio=$2)
    ORDER BY cl.anio DESC, c.anio, c.division, cm.nombre
  `,
    [dni, cycleYear],
  );

  const cycles = new Map();
  for (const row of rows) {
    if (!cycles.has(row.ciclo_lectivo)) {
      cycles.set(row.ciclo_lectivo, {
        anio: row.ciclo_lectivo,
        cursos: [],
        _courses: new Map(),
      });
    }
    const cycle = cycles.get(row.ciclo_lectivo);
    let course = cycle._courses.get(row.id_curso);
    if (!course) {
      course = {
        id_curso: row.id_curso,
        anio: row.anio_curso,
        division: row.division,
        especialidad: row.especialidad,
        turno: row.turno,
        materias: [],
        _subjects: new Map(),
      };
      cycle._courses.set(row.id_curso, course);
      cycle.cursos.push(course);
    }
    if (!row.codigo_materia) continue;
    const subject = {
      codigo: row.codigo_materia,
      nombre: row.materia || row.codigo_materia,
      notas: row.notas || [],
      evaluaciones: row.evaluaciones || [],
    };
    course._subjects.set(subject.codigo, subject);
  }

  const allGrades = [];
  for (const cycle of cycles.values()) {
    const grades = [];
    for (const course of cycle.cursos) {
      course.materias = [...course._subjects.values()];
      for (const subject of course.materias) {
        subject.notas = subject.notas.map(({ id, ...grade }) => ({
          id,
          ...grade,
        }));
        grades.push(...subject.notas);
        allGrades.push(...subject.notas);
      }
      delete course._subjects;
    }
    cycle.promedio = grades.length
      ? grades.reduce((sum, grade) => sum + Number(grade.calificacion), 0) /
        grades.length
      : null;
    delete cycle._courses;
  }

  const student = rows[0];
  return {
    dni,
    nombre: student?.nombre || "",
    apellido: student?.apellido || "",
    fecha_nacimiento: student?.fecha_nacimiento || null,
    genero: student?.genero || null,
    nacionalidad: student?.nacionalidad || null,
    domicilio: [
      student?.calle,
      student?.numero_calle,
      student?.departamento,
      student?.localidad,
    ]
      .filter(Boolean)
      .join(", "),
    promedio_general: allGrades.length
      ? allGrades.reduce((sum, grade) => sum + Number(grade.calificacion), 0) /
        allGrades.length
      : null,
    ciclos: [...cycles.values()].sort((left, right) => right.anio - left.anio),
  };
}

app.get(
  "/api/boletines/:dni",
  auth,
  roles("admin", "preceptor"),
  async (req, res) => {
    const dni = String(req.params.dni || "");
    if (!/^\d{1,20}$/.test(dni)) return fail(res, 400, "El DNI no es válido");
    try {
      const bulletin = await getStudentBulletins(dni, requestedCycleYear(req));
      if (!bulletin.nombre) return fail(res, 404, "No se encontró el alumno");
      res.json(bulletin);
    } catch (error) {
      console.error(error);
      fail(res, 500, "No se pudieron obtener los boletines");
    }
  },
);

app.get("/api/mis-boletines", auth, roles("alumno"), async (req, res) => {
  if (!req.user.dni_alumno)
    return fail(res, 403, "La cuenta no tiene un alumno asignado");
  try {
    res.json(await getStudentBulletins(req.user.dni_alumno));
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener tus boletines");
  }
});

app.post(
  "/api/alumnos",
  auth,
  roles("admin", "preceptor"),
  async (req, res) => {
    const {
      dni,
      nombre,
      apellido,
      email,
      estado = "Activo",
      id_curso,
    } = req.body;
    if (!dni || !nombre || !apellido) {
      return fail(res, 400, "DNI, nombre y apellido son obligatorios");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `
      INSERT INTO alumno (dni, nombre, apellido, email, estado)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `,
        [dni, nombre, apellido, email || null, estado],
      );
      if (estado === "Activo")
        await ensurePersonAccount(client, dni, "alumno", "dni_alumno");
      if (id_curso && estado === "Activo") {
        await client.query(
          `
        INSERT INTO alumno_curso (dni_alumno, id_curso, id_ciclo_lectivo)
        SELECT $1, $2, id_ciclo_lectivo
        FROM ciclo_lectivo
        WHERE id_ciclo_lectivo=$3
      `,
          [dni, id_curso, await getCycleId(client, requestedCycleYear(req))],
        );
      }
      await client.query("COMMIT");
      res.status(201).json(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);
      if (error.code === "23505")
        return fail(res, 409, "Ya existe un alumno con ese DNI");
      fail(res, 400, "No se pudo crear el alumno");
    } finally {
      client.release();
    }
  },
);

app.put(
  "/api/alumnos/:dni",
  auth,
  roles("admin", "preceptor"),
  async (req, res) => {
    const { dni } = req.params;
    const { nombre, apellido, email, estado, id_curso } = req.body;

    const client = await pool.connect();
    let disabledAccountId;
    try {
      await client.query("BEGIN");
      const { rows: alumnoActual } = await client.query(
        "SELECT estado FROM alumno WHERE dni=$1 FOR UPDATE",
        [dni],
      );
      if (!alumnoActual[0]) {
        await client.query("ROLLBACK");
        return fail(res, 404, "Alumno no encontrado");
      }
      const debeDesasignarCurso =
        estado !== undefined &&
        estado !== null &&
        estado !== "Activo" &&
        estado !== alumnoActual[0].estado;
      const { rows } = await client.query(
        `
      UPDATE alumno
      SET nombre=COALESCE($2,nombre),
          apellido=COALESCE($3,apellido),
          email=COALESCE($4,email),
          estado=COALESCE($5,estado)
      WHERE dni=$1
      RETURNING *
    `,
        [dni, nombre, apellido, email, estado],
      );

      if (!rows[0]) {
        await client.query("ROLLBACK");
        return fail(res, 404, "Alumno no encontrado");
      }
      const debeActualizarCurso =
        debeDesasignarCurso ||
        (id_curso !== undefined &&
          (estado === undefined || estado === "Activo"));
      if (debeActualizarCurso) {
        const currentCycleId = await getCycleId(
          client,
          requestedCycleYear(req),
        );
        if (currentCycleId) {
          const cursoAsignado =
            debeDesasignarCurso || id_curso == null || id_curso === ""
              ? null
              : Number(id_curso);
          const { rows: previousEnrollments } = await client.query(
            `
            SELECT ac.id_curso, c.anio, c.id_especialidad
            FROM alumno_curso ac
            JOIN curso c ON c.id_curso=ac.id_curso
              AND c.id_ciclo_lectivo=ac.id_ciclo_lectivo
            WHERE ac.dni_alumno=$1 AND ac.id_ciclo_lectivo=$2
            ORDER BY (ac.fecha_baja IS NULL) DESC,
                     ac.fecha_inscripcion DESC,
                     ac.id_curso DESC
            LIMIT 1
            FOR UPDATE OF ac
          `,
            [dni, currentCycleId],
          );
          const previousCourse = previousEnrollments[0];

          if (cursoAsignado !== null) {
            if (!Number.isInteger(cursoAsignado)) {
              await client.query("ROLLBACK");
              return fail(res, 400, "El curso no es válido");
            }
            const { rows: targetCourses } = await client.query(
              `
              SELECT id_curso, anio, id_especialidad
              FROM curso
              WHERE id_curso=$1 AND id_ciclo_lectivo=$2
            `,
              [cursoAsignado, currentCycleId],
            );
            const targetCourse = targetCourses[0];
            if (!targetCourse) {
              await client.query("ROLLBACK");
              return fail(
                res,
                400,
                "El curso no pertenece al ciclo lectivo seleccionado",
              );
            }

            await client.query(
              `
            UPDATE alumno_curso
            SET fecha_baja=CURRENT_DATE
            WHERE dni_alumno=$1
              AND id_ciclo_lectivo=$2
              AND fecha_baja IS NULL
              AND id_curso<>$3
          `,
              [dni, currentCycleId, cursoAsignado],
            );
            await client.query(
              `
            INSERT INTO alumno_curso (dni_alumno, id_curso, id_ciclo_lectivo)
            VALUES ($1, $2, $3)
            ON CONFLICT (dni_alumno, id_curso, id_ciclo_lectivo)
            DO UPDATE SET fecha_baja = NULL
          `,
              [dni, cursoAsignado, currentCycleId],
            );

            if (previousCourse && previousCourse.id_curso !== cursoAsignado) {
              if (previousCourse.anio !== targetCourse.anio) {
                await client.query(
                  "DELETE FROM nota_individual WHERE dni_alumno=$1 AND id_ciclo_lectivo=$2",
                  [dni, currentCycleId],
                );
                await client.query(
                  "DELETE FROM nota WHERE dni_alumno=$1 AND id_ciclo_lectivo=$2",
                  [dni, currentCycleId],
                );
              } else {
                let retainedSubjectCodes = null;
                if (
                  previousCourse.id_especialidad !==
                  targetCourse.id_especialidad
                ) {
                  const { rows: subjects } = await client.query(
                    `
                    SELECT codigo_materia
                    FROM curso_materia
                    WHERE id_curso=$1 AND id_ciclo_lectivo=$2
                  `,
                    [cursoAsignado, currentCycleId],
                  );
                  retainedSubjectCodes = subjects.map(
                    (subject) => subject.codigo_materia,
                  );
                  await client.query(
                    `
                    DELETE FROM nota_individual
                    WHERE dni_alumno=$1 AND id_ciclo_lectivo=$2
                      AND NOT (codigo_materia=ANY($3::varchar[]))
                  `,
                    [dni, currentCycleId, retainedSubjectCodes],
                  );
                  await client.query(
                    `
                    DELETE FROM nota
                    WHERE dni_alumno=$1 AND id_ciclo_lectivo=$2
                      AND NOT (codigo_materia=ANY($3::varchar[]))
                  `,
                    [dni, currentCycleId, retainedSubjectCodes],
                  );
                }

                await client.query(
                  `
                  UPDATE nota_individual
                  SET id_curso=$3
                  WHERE dni_alumno=$1 AND id_ciclo_lectivo=$2
                    AND ($4::varchar[] IS NULL OR codigo_materia=ANY($4::varchar[]))
                `,
                  [dni, currentCycleId, cursoAsignado, retainedSubjectCodes],
                );
                await client.query(
                  `
                  UPDATE nota
                  SET id_curso=$3
                  WHERE dni_alumno=$1 AND id_ciclo_lectivo=$2
                    AND ($4::varchar[] IS NULL OR codigo_materia=ANY($4::varchar[]))
                `,
                  [dni, currentCycleId, cursoAsignado, retainedSubjectCodes],
                );
              }
            }
          } else {
            await client.query(
              `
            UPDATE alumno_curso SET fecha_baja=CURRENT_DATE
            WHERE dni_alumno=$1 AND id_ciclo_lectivo=$2
              AND fecha_baja IS NULL
          `,
              [dni, currentCycleId],
            );
          }
        }
      }
      if (estado !== undefined) {
        const account = await syncPersonAccount(
          client,
          dni,
          "alumno",
          "dni_alumno",
          estado === "Activo",
        );
        if (!account.isActive) disabledAccountId = account.userId;
      }
      await client.query("COMMIT");
      revokeAccountSessions(disabledAccountId);
      res.json(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(
        "Error al modificar alumno:",
        error.message,
        error.code,
        error.detail,
      );
      fail(res, 400, "No se pudo modificar el alumno");
    } finally {
      client.release();
    }
  },
);

app.delete(
  "/api/alumnos/:dni",
  auth,
  roles("admin", "preceptor"),
  async (req, res) => {
    const { dni } = req.params;
    const client = await pool.connect();
    let deletedUserId;

    try {
      await client.query("BEGIN");

      const alumno = await client.query(
        "SELECT dni FROM alumno WHERE dni=$1 FOR UPDATE",
        [dni],
      );

      if (!alumno.rows[0]) {
        await client.query("ROLLBACK");
        return fail(res, 404, "Alumno no encontrado");
      }

      const { rows } = await client.query(
        `
      SELECT
        EXISTS(SELECT 1 FROM nota WHERE dni_alumno=$1) AS tiene_notas,
        EXISTS(SELECT 1 FROM nota_individual WHERE dni_alumno=$1) AS tiene_notas_individuales,
        EXISTS(SELECT 1 FROM notificacion_alumno WHERE dni_alumno=$1) AS tiene_notificaciones
    `,
        [dni],
      );

      const datos = rows[0];

      if (
        datos.tiene_notas ||
        datos.tiene_notas_individuales ||
        datos.tiene_notificaciones
      ) {
        await client.query("ROLLBACK");
        return fail(
          res,
          409,
          "No se puede eliminar el alumno porque tiene notas o notificaciones asociadas.",
        );
      }

      const cuenta = await client.query(
        "SELECT id_usuario FROM usuario WHERE dni_alumno=$1",
        [dni],
      );

      deletedUserId = cuenta.rows[0]?.id_usuario;

      await client.query("DELETE FROM usuario WHERE dni_alumno=$1", [dni]);
      await client.query("DELETE FROM alumno_curso WHERE dni_alumno=$1", [dni]);
      await client.query(
        "DELETE FROM responsables_alumnos WHERE dni_alumno=$1",
        [dni],
      );
      await client.query("DELETE FROM alumno WHERE dni=$1", [dni]);

      await client.query("COMMIT");

      revokeAccountSessions(deletedUserId);

      return res.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error al eliminar alumno:", error);

      if (error.code === "23503") {
        return fail(
          res,
          409,
          "No se puede eliminar el alumno porque tiene otros datos asociados.",
        );
      }

      return fail(res, 500, "No se pudo eliminar el alumno.");
    } finally {
      client.release();
    }
  },
);

app.get("/api/docentes", auth, async (req, res) => {
  try {
    const cicloLectivo = requestedCycleYear(req);
    const { rows } = await pool.query(
      `
      SELECT p.dni, p.nombre, p.apellido, p.email, p.telefono, p.estado,
             COALESCE((
               SELECT string_agg(DISTINCT m.nombre, ', ')
               FROM profesor_materia pm
               JOIN materia m ON m.codigo=pm.codigo_materia
               WHERE pm.dni_profesor=p.dni
                 AND pm.id_ciclo_lectivo=(SELECT id_ciclo_lectivo FROM ciclo_lectivo WHERE anio=COALESCE($1::integer, (SELECT MAX(anio) FROM ciclo_lectivo)) ORDER BY anio DESC LIMIT 1)
             ), '') AS materias,
             COALESCE(
               string_agg(
                 DISTINCT CONCAT(
                   c.anio,
                   '° ',
                   c.division,
                   CASE WHEN e.nombre IS NULL THEN '' ELSE ' — ' || e.nombre END
                 ),
                 ', '
               ) FILTER (WHERE c.id_curso IS NOT NULL),
               ''
             ) AS cursos,
             COALESCE((
               SELECT json_agg(json_build_object(
                 'codigo_materia', por_materia.codigo_materia,
                 'nombre', por_materia.nombre,
                 'cursos', por_materia.cursos
               ) ORDER BY por_materia.nombre)
               FROM (
                 SELECT pm.codigo_materia, materia.nombre,
                        COALESCE(json_agg(json_build_object(
                          'id_curso', c2.id_curso,
                          'label', CONCAT(
                            c2.anio,
                            '° ',
                            c2.division,
                            CASE WHEN e2.nombre IS NULL THEN '' ELSE ' — ' || e2.nombre END
                          )
                        ) ORDER BY c2.anio, c2.division, e2.nombre)
                          FILTER (WHERE c2.id_curso IS NOT NULL), '[]'::json) AS cursos
                 FROM profesor_materia pm
                 JOIN materia materia ON materia.codigo=pm.codigo_materia
                 LEFT JOIN profesor_curso_materia pcm ON pcm.dni_profesor=pm.dni_profesor
                   AND pcm.codigo_materia=pm.codigo_materia
                   AND pcm.id_ciclo_lectivo=pm.id_ciclo_lectivo
                 LEFT JOIN curso c2 ON c2.id_curso=pcm.id_curso
                   AND c2.id_ciclo_lectivo=pcm.id_ciclo_lectivo
                 LEFT JOIN especialidad e2 ON e2.id_especialidad=c2.id_especialidad
                 WHERE pm.dni_profesor=p.dni
                   AND pm.id_ciclo_lectivo=(
                     SELECT id_ciclo_lectivo FROM ciclo_lectivo WHERE anio=COALESCE($1::integer, (SELECT MAX(anio) FROM ciclo_lectivo)) ORDER BY anio DESC LIMIT 1
                   )
                 GROUP BY pm.codigo_materia, materia.nombre
               ) por_materia
             ), '[]'::json) AS asignaciones
      FROM profesor p
      LEFT JOIN profesor_curso_materia pcm ON pcm.dni_profesor=p.dni
        AND pcm.id_ciclo_lectivo=(
          SELECT id_ciclo_lectivo FROM ciclo_lectivo WHERE anio=COALESCE($1::integer, (SELECT MAX(anio) FROM ciclo_lectivo)) ORDER BY anio DESC LIMIT 1
        )
      LEFT JOIN curso c ON c.id_curso=pcm.id_curso
      LEFT JOIN especialidad e ON e.id_especialidad=c.id_especialidad
      GROUP BY p.dni
      ORDER BY p.apellido, p.nombre
    `,
      [cicloLectivo],
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener los docentes");
  }
});

const ESTADOS_DOCENTE = new Set(["Activo", "Baja"]);

function validateDocente(body) {
  if (!body || !/^\d{1,20}$/.test(String(body.dni || "")))
    return "El DNI del docente no es válido";
  if (
    typeof body.nombre !== "string" ||
    !body.nombre.trim() ||
    body.nombre.trim().length > 80
  )
    return "El nombre del docente no es válido";
  if (
    typeof body.apellido !== "string" ||
    !body.apellido.trim() ||
    body.apellido.trim().length > 80
  )
    return "El apellido del docente no es válido";
  if (!ESTADOS_DOCENTE.has(body.estado))
    return "El estado del docente no es válido";
  if (
    body.email != null &&
    (typeof body.email !== "string" || body.email.length > 150)
  )
    return "El email del docente no es válido";
  if (
    body.telefono != null &&
    (typeof body.telefono !== "string" || body.telefono.length > 30)
  )
    return "El teléfono del docente no es válido";
  if (!Array.isArray(body.asignaciones))
    return "Las asignaciones del docente no son válidas";
  const subjectCodes = new Set();
  for (const assignment of body.asignaciones) {
    if (
      !assignment ||
      typeof assignment.codigo_materia !== "string" ||
      !Array.isArray(assignment.cursos)
    ) {
      return "Las asignaciones del docente no son válidas";
    }
    if (subjectCodes.has(assignment.codigo_materia))
      return "No repitas una materia en las asignaciones";
    subjectCodes.add(assignment.codigo_materia);
    if (
      new Set(assignment.cursos.map(String)).size !== assignment.cursos.length
    ) {
      return "No repitas cursos dentro de una materia";
    }
  }
  return null;
}

async function replaceTeacherAssignments(client, dni, assignments, cycleId) {
  const selectedCourseIds = [
    ...new Set(
      assignments.flatMap((assignment) => assignment.cursos.map(Number)),
    ),
  ];
  const subjectCodes = assignments.map(
    (assignment) => assignment.codigo_materia,
  );
  const courseSubjectCount = assignments.reduce(
    (count, assignment) => count + assignment.cursos.length,
    0,
  );
  if (selectedCourseIds.some((id) => !Number.isInteger(id)))
    throw new Error("Un curso asignado no es válido");
  if (selectedCourseIds.length) {
    const { rows } = await client.query(
      `
      SELECT id_curso FROM curso
      WHERE id_ciclo_lectivo=$1 AND id_curso=ANY($2::integer[])
    `,
      [cycleId, selectedCourseIds],
    );
    if (rows.length !== selectedCourseIds.length)
      throw new Error("Uno o más cursos no pertenecen al ciclo lectivo actual");
  }
  if (subjectCodes.length) {
    const { rows } = await client.query(
      "SELECT codigo_materia FROM ciclo_materia WHERE id_ciclo_lectivo=$1 AND codigo_materia=ANY($2::varchar[])",
      [cycleId, subjectCodes],
    );
    if (rows.length !== subjectCodes.length)
      throw new Error("Una o más materias no existen");
  }

  if (courseSubjectCount) {
    const { rows } = await client.query(
      `
      SELECT id_curso, codigo_materia
      FROM curso_materia
      WHERE id_ciclo_lectivo=$1
        AND id_curso=ANY($2::integer[])
        AND codigo_materia=ANY($3::varchar[])
    `,
      [cycleId, selectedCourseIds, subjectCodes],
    );
    if (rows.length !== courseSubjectCount) {
      throw new Error(
        "Solo se pueden asignar cursos que tengan asignada la materia correspondiente",
      );
    }
  }

  await client.query(
    "DELETE FROM profesor_curso_materia WHERE dni_profesor=$1 AND id_ciclo_lectivo=$2",
    [dni, cycleId],
  );
  await client.query(
    "DELETE FROM profesor_materia WHERE dni_profesor=$1 AND id_ciclo_lectivo=$2",
    [dni, cycleId],
  );
  for (const assignment of assignments) {
    await client.query(
      `
      INSERT INTO profesor_materia (dni_profesor,codigo_materia,id_ciclo_lectivo)
      VALUES ($1,$2,$3)
    `,
      [dni, assignment.codigo_materia, cycleId],
    );
    for (const courseId of assignment.cursos) {
      await client.query(
        `
        INSERT INTO profesor_curso_materia (dni_profesor,id_curso,codigo_materia,id_ciclo_lectivo)
        VALUES ($1,$2,$3,$4)
      `,
        [dni, Number(courseId), assignment.codigo_materia, cycleId],
      );
    }
  }
}

app.post(
  "/api/docentes",
  auth,
  roles("admin", "preceptor"),
  async (req, res) => {
    const validationError = validateDocente(req.body);
    if (validationError) return fail(res, 400, validationError);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cycleId = await getCycleId(client, requestedCycleYear(req));
      if (!cycleId) throw new Error("No hay un ciclo lectivo seleccionado");
      const { dni, nombre, apellido, email, telefono, estado, asignaciones } =
        req.body;
      await client.query(
        `
      INSERT INTO profesor (dni,nombre,apellido,email,telefono,estado)
      VALUES ($1,$2,$3,$4,$5,$6)
    `,
        [
          dni,
          nombre.trim(),
          apellido.trim(),
          email?.trim() || null,
          telefono?.trim() || null,
          estado,
        ],
      );
      if (estado === "Activo")
        await ensurePersonAccount(client, dni, "profesor", "dni_profesor");
      await replaceTeacherAssignments(
        client,
        dni,
        estado === "Baja" ? [] : asignaciones,
        cycleId,
      );
      await client.query("COMMIT");
      res.status(201).json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505")
        return fail(res, 409, "Ya existe un docente con ese DNI");
      console.error(error);
      fail(res, 400, error.message || "No se pudo crear el docente");
    } finally {
      client.release();
    }
  },
);

app.put(
  "/api/docentes/:dni",
  auth,
  roles("admin", "preceptor"),
  async (req, res) => {
    const { dni } = req.params;
    if (String(req.body.dni) !== dni)
      return fail(res, 400, "El DNI no puede modificarse");
    const validationError = validateDocente(req.body);
    if (validationError) return fail(res, 400, validationError);
    const client = await pool.connect();
    let disabledAccountId;
    try {
      await client.query("BEGIN");
      const cycleId = await getCycleId(client, requestedCycleYear(req));
      if (!cycleId) throw new Error("No hay un ciclo lectivo seleccionado");
      const { rows } = await client.query(
        `
      UPDATE profesor
      SET nombre=$2, apellido=$3, email=$4, telefono=$5, estado=$6
      WHERE dni=$1
      RETURNING dni
    `,
        [
          dni,
          req.body.nombre.trim(),
          req.body.apellido.trim(),
          req.body.email?.trim() || null,
          req.body.telefono?.trim() || null,
          req.body.estado,
        ],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return fail(res, 404, "Docente no encontrado");
      }
      await replaceTeacherAssignments(
        client,
        dni,
        req.body.estado === "Baja" ? [] : req.body.asignaciones,
        cycleId,
      );
      const account = await syncPersonAccount(
        client,
        dni,
        "profesor",
        "dni_profesor",
        req.body.estado === "Activo",
      );
      if (!account.isActive) disabledAccountId = account.userId;
      await client.query("COMMIT");
      revokeAccountSessions(disabledAccountId);
      res.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);
      fail(res, 400, error.message || "No se pudo modificar el docente");
    } finally {
      client.release();
    }
  },
);

app.delete(
  "/api/docentes/:dni",
  auth,
  roles("admin", "preceptor"),
  async (req, res) => {
    const { dni } = req.params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const teacher = await client.query(
        "SELECT dni FROM profesor WHERE dni=$1 FOR UPDATE",
        [dni],
      );
      if (!teacher.rows[0]) {
        await client.query("ROLLBACK");
        return fail(res, 404, "Docente no encontrado");
      }
      const { rows } = await client.query(
        `
      SELECT
        EXISTS(SELECT 1 FROM profesor_curso_materia WHERE dni_profesor=$1) AS tiene_asignaciones,
        EXISTS(SELECT 1 FROM profesor_materia WHERE dni_profesor=$1) AS tiene_materias,
        EXISTS(SELECT 1 FROM nota WHERE dni_profesor=$1) AS tiene_notas,
        EXISTS(SELECT 1 FROM nota_individual WHERE dni_profesor=$1) AS tiene_notas_individuales
    `,
        [dni],
      );
      if (Object.values(rows[0]).some(Boolean)) {
        await client.query("ROLLBACK");
        return fail(
          res,
          409,
          "No se puede eliminar un docente con materias, asignaciones o notas asociadas",
        );
      }
      await client.query("DELETE FROM usuario WHERE dni_profesor=$1", [dni]);
      await client.query("DELETE FROM profesor_rol WHERE dni_profesor=$1", [
        dni,
      ]);
      await client.query("DELETE FROM profesor WHERE dni=$1", [dni]);
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);
      fail(res, 400, "No se pudo eliminar el docente");
    } finally {
      client.release();
    }
  },
);

function registerPersonnelRoutes({
  path,
  table,
  role,
  dniColumn,
  includeCargo = false,
}) {
  function validatePersonnelData(values, expectedDni = null) {
    const { dni, apellido, nombre, email, telefono, estado, cargo } = values;
    const emailValue = email ?? "";
    const telefonoValue = telefono ?? "";
    const errors = [];

    if (!/^\d{1,20}$/.test(String(dni || "")))
      errors.push("DNI: ingresá entre 1 y 20 números.");
    if (expectedDni != null && String(dni) !== expectedDni)
      errors.push("DNI: no se puede cambiar desde este formulario.");
    if (typeof apellido !== "string" || !apellido.trim())
      errors.push("Apellido: es obligatorio.");
    else if (apellido.trim().length > 80)
      errors.push("Apellido: no puede superar los 80 caracteres.");
    if (typeof nombre !== "string" || !nombre.trim())
      errors.push("Nombre: es obligatorio.");
    else if (nombre.trim().length > 80)
      errors.push("Nombre: no puede superar los 80 caracteres.");
    if (typeof emailValue !== "string")
      errors.push("Email: ingresá texto válido.");
    else if (emailValue.length > 150)
      errors.push("Email: no puede superar los 150 caracteres.");
    else if (
      emailValue &&
      !/^[^\s@]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(emailValue)
    )
      errors.push("Email: usá un formato como usuario@dominio o usuario@dominio.com.");
    if (typeof telefonoValue !== "string")
      errors.push("Teléfono: ingresá texto válido.");
    else if (telefonoValue.length > 30)
      errors.push("Teléfono: no puede superar los 30 caracteres.");
    if (!["Activo", "Baja"].includes(estado))
      errors.push("Estado: seleccioná Activo o Baja.");
    if (
      includeCargo &&
      cargo != null &&
      !["Regente", "Subregente"].includes(cargo)
    )
      errors.push("Cargo: seleccioná Regente, Subregente o Sin cargo.");

    return errors.length ? errors.join(" ") : null;
  }

  app.get(`/api/${path}`, auth, roles("admin"), async (_req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT dni, apellido, nombre, email, telefono, estado${includeCargo ? ", cargo" : ""}
        FROM ${table}
        ORDER BY apellido, nombre
      `);
      res.json(rows);
    } catch (error) {
      console.error(error);
      fail(res, 500, `No se pudieron obtener los ${path}`);
    }
  });

  app.post(`/api/${path}`, auth, roles("admin"), async (req, res) => {
    const {
      dni,
      apellido,
      nombre,
      email = "",
      telefono = "",
      estado = "Activo",
      cargo = null,
    } = req.body || {};
    const emailValue = email ?? "";
    const telefonoValue = telefono ?? "";
    const validationError = validatePersonnelData({
      dni,
      apellido,
      nombre,
      email,
      telefono,
      estado,
      cargo,
    });
    if (validationError)
      return res.status(400).json({ error: validationError });
    if (
      !/^\d{1,20}$/.test(String(dni || "")) ||
      typeof apellido !== "string" ||
      !apellido.trim() ||
      apellido.trim().length > 80 ||
      typeof nombre !== "string" ||
      !nombre.trim() ||
      nombre.trim().length > 80 ||
      typeof emailValue !== "string" ||
      emailValue.length > 150 ||
      (emailValue && !/^[^\s@]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(emailValue)) ||
      typeof telefonoValue !== "string" ||
      telefonoValue.length > 30 ||
      !["Activo", "Baja"].includes(estado) ||
      (includeCargo &&
        cargo != null &&
        !["Regente", "Subregente"].includes(cargo))
    ) {
      return fail(res, 400, `Los datos de ${role} no son válidos`);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
        INSERT INTO ${table} (dni, apellido, nombre, email, telefono, estado${includeCargo ? ", cargo" : ""})
        VALUES ($1,$2,$3,$4,$5,$6${includeCargo ? ",$7" : ""})
      `,
        includeCargo
          ? [
              dni,
              apellido.trim(),
              nombre.trim(),
              emailValue || null,
              telefonoValue || null,
              estado,
              cargo,
            ]
          : [
              dni,
              apellido.trim(),
              nombre.trim(),
              emailValue || null,
              telefonoValue || null,
              estado,
            ],
      );
      if (estado === "Activo")
        await ensurePersonAccount(client, dni, role, dniColumn);
      await client.query("COMMIT");
      res.status(201).json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505")
        return fail(res, 409, "Ya existe una persona o cuenta con ese DNI");
      console.error(error);
      fail(res, 400, `No se pudo crear ${role}`);
    } finally {
      client.release();
    }
  });

  app.put(`/api/${path}/:dni`, auth, roles("admin"), async (req, res) => {
    const { dni } = req.params;
    const {
      apellido,
      nombre,
      email = "",
      telefono = "",
      estado = "Activo",
      cargo = null,
    } = req.body || {};
    const emailValue = email ?? "";
    const telefonoValue = telefono ?? "";
    const validationError = validatePersonnelData(
      { dni: req.body?.dni, apellido, nombre, email, telefono, estado, cargo },
      dni,
    );
    if (validationError)
      return res.status(400).json({ error: validationError });
    if (
      String(req.body?.dni) !== dni ||
      typeof apellido !== "string" ||
      !apellido.trim() ||
      apellido.trim().length > 80 ||
      typeof nombre !== "string" ||
      !nombre.trim() ||
      nombre.trim().length > 80 ||
      typeof emailValue !== "string" ||
      emailValue.length > 150 ||
      (emailValue && !/^[^\s@]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(emailValue)) ||
      typeof telefonoValue !== "string" ||
      telefonoValue.length > 30 ||
      !["Activo", "Baja"].includes(estado) ||
      (includeCargo &&
        cargo != null &&
        !["Regente", "Subregente"].includes(cargo))
    ) {
      return fail(res, 400, `Los datos de ${role} no son válidos`);
    }

    const client = await pool.connect();
    let disabledAccountId;
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `
        UPDATE ${table}
        SET apellido=$2, nombre=$3, email=$4, telefono=$5, estado=$6${includeCargo ? ", cargo=$7" : ""}
        WHERE dni=$1
        RETURNING dni
      `,
        includeCargo
          ? [
              dni,
              apellido.trim(),
              nombre.trim(),
              emailValue || null,
              telefonoValue || null,
              estado,
              cargo,
            ]
          : [
              dni,
              apellido.trim(),
              nombre.trim(),
              emailValue || null,
              telefonoValue || null,
              estado,
            ],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return fail(res, 404, `${role} no encontrado`);
      }
      const account = await syncPersonAccount(
        client,
        dni,
        role,
        dniColumn,
        estado === "Activo",
      );
      if (!account.isActive) disabledAccountId = account.userId;
      await client.query("COMMIT");
      revokeAccountSessions(disabledAccountId);
      res.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);
      fail(res, 400, `No se pudo modificar ${role}`);
    } finally {
      client.release();
    }
  });

  app.delete(`/api/${path}/:dni`, auth, roles("admin"), async (req, res) => {
    const { dni } = req.params;
    if (role === "admin" && String(req.user.dni_administrador) === dni)
      return fail(res, 409, "No podés eliminar tu propia cuenta de administrador");
    const client = await pool.connect();
    let deletedUserId;
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT dni FROM ${table} WHERE dni=$1 FOR UPDATE`,
        [dni],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return fail(res, 404, `${role} no encontrado`);
      }
      const deletedAccount = await client.query(
        `DELETE FROM usuario WHERE ${dniColumn}=$1 RETURNING id_usuario`,
        [dni],
      );
      deletedUserId = deletedAccount.rows[0]?.id_usuario;
      await client.query(`DELETE FROM ${table} WHERE dni=$1`, [dni]);
      await client.query("COMMIT");
      revokeAccountSessions(deletedUserId);
      res.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);
      fail(res, 400, `No se pudo eliminar ${role}`);
    } finally {
      client.release();
    }
  });
}

registerPersonnelRoutes({
  path: "preceptores",
  table: "preceptor",
  role: "preceptor",
  dniColumn: "dni_preceptor",
});
registerPersonnelRoutes({
  path: "administradores",
  table: "administrador",
  role: "admin",
  dniColumn: "dni_administrador",
  includeCargo: true,
});

app.get("/api/cursos", auth, async (req, res) => {
  try {
    const cicloLectivo = Number(req.query.ciclo_lectivo) || null;
    const { rows } = await pool.query(
      `
      SELECT c.*,
             COUNT(DISTINCT a.dni)::int AS cantidad_alumnos,
         cl.anio AS ciclo_lectivo,
             e.nombre AS especialidad,
         t.id_turno AS turno_id,
             t.jornada AS turno,
             COALESCE(
               JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('codigo', m.codigo, 'nombre', m.nombre))
                 FILTER (WHERE m.codigo IS NOT NULL),
               '[]'::jsonb
             ) AS materias
      FROM curso c
      LEFT JOIN especialidad e ON e.id_especialidad=c.id_especialidad
      JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=c.id_ciclo_lectivo
      LEFT JOIN alumno_curso ac ON ac.id_curso=c.id_curso
        AND ac.id_ciclo_lectivo=c.id_ciclo_lectivo
        AND ac.fecha_baja IS NULL
      LEFT JOIN alumno a ON a.dni=ac.dni_alumno AND a.estado='Activo'
      LEFT JOIN curso_turno ct ON ct.id_curso=c.id_curso
      LEFT JOIN turno t ON t.id_turno=ct.id_turno
      LEFT JOIN curso_materia cm ON cm.id_curso=c.id_curso
        AND cm.id_ciclo_lectivo=c.id_ciclo_lectivo
      LEFT JOIN materia m ON m.codigo=cm.codigo_materia
      GROUP BY c.id_curso, cl.anio, e.nombre, t.id_turno, t.jornada
      HAVING cl.anio=COALESCE($1::integer, (SELECT MAX(anio) FROM ciclo_lectivo))
      ORDER BY c.anio, c.division
    `,
      [cicloLectivo],
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener los cursos");
  }
});

app.get(
  "/api/docente-asignaciones",
  auth,
  roles("profesor"),
  async (req, res) => {
    if (!req.user.dni_profesor)
      return fail(res, 403, "El usuario no tiene un docente asignado");
    try {
      const cycleId = await getCycleId(pool, requestedCycleYear(req));
      if (!cycleId) return res.json([]);
      const { rows } = await pool.query(
        `
      SELECT DISTINCT pcm.id_curso, pcm.codigo_materia
      FROM profesor_curso_materia pcm
      WHERE pcm.dni_profesor=$1
        AND pcm.id_ciclo_lectivo=$2
      ORDER BY pcm.id_curso, pcm.codigo_materia
    `,
        [req.user.dni_profesor, cycleId],
      );
      res.json(rows);
    } catch (error) {
      console.error(error);
      fail(res, 500, "No se pudieron obtener las asignaciones del docente");
    }
  },
);

app.post("/api/cursos", auth, roles("admin"), async (req, res) => {
  const anio = Number(req.body.anio);
  const especialidad = anio <= 2 ? null : req.body.especialidad;
  const turnoId =
    req.body.turno_id == null || req.body.turno_id === ""
      ? null
      : Number(req.body.turno_id);

  if (!Number.isInteger(anio) || anio < 1 || anio > 6) {
    return fail(res, 400, "El año debe estar entre 1 y 6");
  }
  if (turnoId !== null && !Number.isInteger(turnoId)) {
    return fail(res, 400, "El turno no es válido");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const specialtyResult = await client.query(
      "SELECT id_especialidad FROM especialidad WHERE nombre=$1",
      [especialidad],
    );
    if (anio >= 3 && !specialtyResult.rows[0])
      throw new Error("La especialidad no es válida");
    const idEspecialidad = specialtyResult.rows[0]?.id_especialidad || null;
    const cycleId = await getCycleId(client, requestedCycleYear(req));
    if (!cycleId) {
      await client.query("ROLLBACK");
      return fail(res, 400, "No hay un ciclo lectivo seleccionado");
    }

    const { rows } = await client.query(
      `
      INSERT INTO curso (anio, division, id_ciclo_lectivo, id_especialidad)
      VALUES ($1,'1',$2,$3)
      RETURNING *
    `,
      [anio, cycleId, idEspecialidad],
    );

    if (turnoId !== null) {
      const turnoResult = await client.query(
        "SELECT id_turno FROM turno WHERE id_turno=$1",
        [turnoId],
      );
      if (!turnoResult.rows[0])
        throw new Error("El turno no pertenece al ciclo lectivo seleccionado");
      await client.query(
        "INSERT INTO curso_turno (id_curso, id_turno) VALUES ($1,$2)",
        [rows[0].id_curso, turnoId],
      );
    }
    await replaceCourseSubjects(
      client,
      rows[0].id_curso,
      cycleId,
      req.body.materias === undefined ? [] : req.body.materias,
    );
    await client.query("COMMIT");
    res.status(201).json({
      ...rows[0],
      especialidad,
      turno_id: turnoId,
      materias: req.body.materias || [],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505")
      return fail(res, 409, "Ya existe ese curso en el ciclo lectivo actual");
    if (error.code === "23503")
      return fail(res, 400, "El turno o la especialidad no existen");
    console.error(error);
    fail(res, 400, "No se pudo crear el curso");
  } finally {
    client.release();
  }
});

app.put("/api/cursos/:id", auth, roles("admin"), async (req, res) => {
  const idCurso = Number(req.params.id);
  const anio = Number(req.body.anio);
  const especialidad = anio <= 2 ? null : req.body.especialidad;
  const turnoId =
    req.body.turno_id == null || req.body.turno_id === ""
      ? null
      : Number(req.body.turno_id);

  if (
    !Number.isInteger(idCurso) ||
    !Number.isInteger(anio) ||
    anio < 1 ||
    anio > 6
  ) {
    return fail(res, 400, "El curso o el año no son válidos");
  }
  if (turnoId !== null && !Number.isInteger(turnoId)) {
    return fail(res, 400, "El turno no es válido");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const specialtyResult = await client.query(
      "SELECT id_especialidad FROM especialidad WHERE nombre=$1",
      [especialidad],
    );
    if (anio >= 3 && !specialtyResult.rows[0])
      throw new Error("La especialidad no es válida");
    const idEspecialidad = specialtyResult.rows[0]?.id_especialidad || null;
    const cycleId = await getCycleId(client, requestedCycleYear(req));
    if (!cycleId) {
      await client.query("ROLLBACK");
      return fail(res, 400, "No hay un ciclo lectivo seleccionado");
    }

    const { rows } = await client.query(
      `
      UPDATE curso
      SET anio=$2, division='1', id_especialidad=$3
      WHERE id_curso=$1 AND id_ciclo_lectivo=$4
      RETURNING *
    `,
      [idCurso, anio, idEspecialidad, cycleId],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return fail(res, 404, "Curso no encontrado en el ciclo lectivo actual");
    }

    if (turnoId === null) {
      await client.query("DELETE FROM curso_turno WHERE id_curso=$1", [
        idCurso,
      ]);
    } else {
      const turnoResult = await client.query(
        "SELECT id_turno FROM turno WHERE id_turno=$1",
        [turnoId],
      );
      if (!turnoResult.rows[0])
        throw new Error("El turno no pertenece al ciclo lectivo seleccionado");
      await client.query(
        `
        INSERT INTO curso_turno (id_curso, id_turno)
        VALUES ($1,$2)
        ON CONFLICT (id_curso) DO UPDATE SET id_turno=EXCLUDED.id_turno
      `,
        [idCurso, turnoId],
      );
    }
    await replaceCourseSubjects(
      client,
      idCurso,
      cycleId,
      req.body.materias === undefined ? [] : req.body.materias,
    );
    await client.query("COMMIT");
    res.json({
      ...rows[0],
      especialidad,
      turno_id: turnoId,
      materias: req.body.materias || [],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505")
      return fail(res, 409, "Ya existe ese curso en el ciclo lectivo actual");
    if (error.code === "23503")
      return fail(res, 400, "El turno o la especialidad no existen");
    console.error(error);
    fail(res, 400, "No se pudo modificar el curso");
  } finally {
    client.release();
  }
});

app.delete("/api/cursos/:id", auth, roles("admin"), async (req, res) => {
  const idCurso = Number(req.params.id);
  if (!Number.isInteger(idCurso))
    return fail(res, 400, "El curso no es válido");

  try {
    const { rows } = await pool.query(
      `
      DELETE FROM curso
      WHERE id_curso=$1
        AND id_ciclo_lectivo=(SELECT id_ciclo_lectivo FROM ciclo_lectivo WHERE anio=COALESCE($2::integer, (SELECT MAX(anio) FROM ciclo_lectivo)))
      RETURNING id_curso
    `,
      [idCurso, requestedCycleYear(req)],
    );
    if (!rows[0])
      return fail(res, 404, "Curso no encontrado en el ciclo lectivo actual");
    res.json({ ok: true });
  } catch (error) {
    if (error.code === "23503") {
      return fail(
        res,
        409,
        "No se puede eliminar un curso con alumnos o notas asociadas",
      );
    }
    console.error(error);
    fail(res, 400, "No se pudo eliminar el curso");
  }
});

app.get("/api/ciclos-lectivos", auth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id_ciclo_lectivo, anio
      FROM ciclo_lectivo
      ORDER BY anio DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener los ciclos lectivos");
  }
});

app.post("/api/ciclos-lectivos", auth, roles("admin"), async (req, res) => {
  const anio = Number(req.body.anio);
  const copiarDesde =
    req.body.copiar_desde == null || req.body.copiar_desde === ""
      ? null
      : Number(req.body.copiar_desde);
  if (!Number.isInteger(anio) || anio < 1900 || anio > 2200) {
    return fail(res, 400, "El año debe estar entre 1900 y 2200");
  }

  if (
    copiarDesde !== null &&
    (!Number.isInteger(copiarDesde) ||
      copiarDesde < 1900 ||
      copiarDesde > 2200 ||
      copiarDesde === anio)
  ) {
    return fail(res, 400, "El ciclo de origen no es válido");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sourceCycle =
      copiarDesde === null
        ? null
        : await client.query(
            "SELECT id_ciclo_lectivo FROM ciclo_lectivo WHERE anio=$1",
            [copiarDesde],
          );
    if (copiarDesde !== null && !sourceCycle.rows[0]) {
      await client.query("ROLLBACK");
      return fail(res, 404, "El ciclo de origen no existe");
    }
    const { rows } = await client.query(
      `
      INSERT INTO ciclo_lectivo (anio)
      VALUES ($1)
      RETURNING id_ciclo_lectivo, anio
    `,
      [anio],
    );
    const targetCycleId = rows[0].id_ciclo_lectivo;

    if (sourceCycle?.rows[0]) {
      const sourceCycleId = sourceCycle.rows[0].id_ciclo_lectivo;
      const { rows: sourceTurns } = await client.query(
        `
        SELECT t.id_turno, t.jornada
        FROM turno t
        ORDER BY t.id_turno
      `,
      );
      const turnIds = new Map();
      for (const turno of sourceTurns) {
        turnIds.set(turno.id_turno, turno.id_turno);
      }

      await client.query(
        `
        INSERT INTO ciclo_materia (id_ciclo_lectivo, codigo_materia)
        SELECT $1, codigo_materia
        FROM ciclo_materia
        WHERE id_ciclo_lectivo=$2
        ON CONFLICT (id_ciclo_lectivo, codigo_materia) DO NOTHING
      `,
        [targetCycleId, sourceCycleId],
      );

      const { rows: sourceCourses } = await client.query(
        `
        SELECT c.*, ct.id_turno
        FROM curso c
        LEFT JOIN curso_turno ct ON ct.id_curso=c.id_curso
        WHERE c.id_ciclo_lectivo=$1
        ORDER BY c.id_curso
      `,
        [sourceCycleId],
      );
      const courseIds = new Map();
      for (const curso of sourceCourses) {
        const clonedCourse = await client.query(
          `
          INSERT INTO curso (anio, division, id_ciclo_lectivo, id_especialidad)
          VALUES ($1,$2,$3,$4)
          RETURNING id_curso
        `,
          [curso.anio, curso.division, targetCycleId, curso.id_especialidad],
        );
        const newCourseId = clonedCourse.rows[0].id_curso;
        courseIds.set(curso.id_curso, newCourseId);
        const newTurnId = turnIds.get(curso.id_turno);
        if (newTurnId) {
          await client.query(
            "INSERT INTO curso_turno (id_curso, id_turno) VALUES ($1,$2)",
            [newCourseId, newTurnId],
          );
        }
        await client.query(
          `
          INSERT INTO curso_materia (id_curso, codigo_materia, id_ciclo_lectivo)
          SELECT $1, codigo_materia, $3
          FROM curso_materia
          WHERE id_curso=$2 AND id_ciclo_lectivo=$4
        `,
          [newCourseId, curso.id_curso, targetCycleId, sourceCycleId],
        );
      }

      await client.query(
        `
        INSERT INTO profesor_materia (dni_profesor, codigo_materia, id_ciclo_lectivo)
        SELECT dni_profesor, codigo_materia, $1
        FROM profesor_materia
        WHERE id_ciclo_lectivo=$2
      `,
        [targetCycleId, sourceCycleId],
      );
      const { rows: teacherAssignments } = await client.query(
        `
        SELECT dni_profesor, id_curso, codigo_materia
        FROM profesor_curso_materia
        WHERE id_ciclo_lectivo=$1
      `,
        [sourceCycleId],
      );
      for (const assignment of teacherAssignments) {
        const newCourseId = courseIds.get(assignment.id_curso);
        if (newCourseId) {
          await client.query(
            `
            INSERT INTO profesor_curso_materia
              (dni_profesor, id_curso, codigo_materia, id_ciclo_lectivo)
            VALUES ($1,$2,$3,$4)
          `,
            [
              assignment.dni_profesor,
              newCourseId,
              assignment.codigo_materia,
              targetCycleId,
            ],
          );
        }
      }
    }

    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505")
      return fail(res, 409, "Ya existe ese ciclo lectivo");
    console.error(error);
    fail(res, 400, "No se pudo crear el ciclo lectivo");
  } finally {
    client.release();
  }
});

app.delete(
  "/api/ciclos-lectivos/:id",
  auth,
  roles("admin"),
  async (req, res) => {
    const idCiclo = Number(req.params.id);
    if (!Number.isInteger(idCiclo) || idCiclo < 1)
      return fail(res, 400, "El ciclo lectivo no es válido");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cycleResult = await client.query(
        "SELECT id_ciclo_lectivo FROM ciclo_lectivo WHERE id_ciclo_lectivo=$1 FOR UPDATE",
        [idCiclo],
      );
      if (!cycleResult.rows[0]) {
        await client.query("ROLLBACK");
        return fail(res, 404, "Ciclo lectivo no encontrado");
      }

      const { rows } = await client.query(
        `
      SELECT
        EXISTS(SELECT 1 FROM curso WHERE id_ciclo_lectivo=$1) AS tiene_cursos,
        EXISTS(SELECT 1 FROM alumno_curso WHERE id_ciclo_lectivo=$1) AS tiene_inscripciones,
        EXISTS(SELECT 1 FROM profesor_curso_materia WHERE id_ciclo_lectivo=$1) AS tiene_asignaciones,
        EXISTS(SELECT 1 FROM nota WHERE id_ciclo_lectivo=$1)
          OR EXISTS(SELECT 1 FROM nota_individual WHERE id_ciclo_lectivo=$1) AS tiene_notas
    `,
        [idCiclo],
      );
      const cicloOcupado = Object.values(rows[0]).some(Boolean);
      if (cicloOcupado) {
        await client.query("ROLLBACK");
        return fail(
          res,
          409,
          "No se puede eliminar un ciclo lectivo con datos asignados",
        );
      }

      await client.query(
        "DELETE FROM ciclo_lectivo WHERE id_ciclo_lectivo=$1",
        [idCiclo],
      );
      await client.query("COMMIT");
      res.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23503") {
        return fail(
          res,
          409,
          "No se puede eliminar un ciclo lectivo con datos asignados",
        );
      }
      console.error(error);
      fail(res, 400, "No se pudo eliminar el ciclo lectivo");
    } finally {
      client.release();
    }
  },
);

app.get("/api/turnos", auth, roles("admin"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT id_turno, jornada
      FROM turno
      ORDER BY CASE jornada
        WHEN 'Mañana' THEN 1
        WHEN 'Tarde' THEN 2
        WHEN 'Noche' THEN 3
        ELSE 4
      END, jornada
    `,
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener los turnos");
  }
});

const fixedTurnosError = (_req, res) =>
  fail(res, 409, "Los turnos disponibles son fijos: Mañana, Tarde y Noche");

app.post("/api/turnos", auth, roles("admin"), fixedTurnosError);
app.put("/api/turnos/:id", auth, roles("admin"), fixedTurnosError);
app.delete("/api/turnos/:id", auth, roles("admin"), fixedTurnosError);

app.get("/api/materias", auth, async (req, res) => {
  try {
    const cycleId = await getCycleId(pool, requestedCycleYear(req));
    if (!cycleId) return res.json([]);
    const { rows } = await pool.query(
      `
      SELECT m.codigo, m.nombre,
             COALESCE(
               (
                 SELECT json_agg(json_build_object(
                   'dni', p.dni,
                   'nombre', p.apellido || ', ' || p.nombre,
                   'cursos', asignaciones.cursos
                 ) ORDER BY p.apellido, p.nombre)
                 FROM (
                   SELECT pm.dni_profesor,
                          COALESCE(array_agg(DISTINCT CONCAT(
                            c.anio,
                            '° ',
                            c.division,
                            CASE WHEN e.nombre IS NULL THEN '' ELSE ' — ' || e.nombre END
                          ))
                            FILTER (WHERE c.id_curso IS NOT NULL), ARRAY[]::text[]) AS cursos
                   FROM profesor_materia pm
                   LEFT JOIN profesor_curso_materia pcm ON pcm.dni_profesor=pm.dni_profesor
                     AND pcm.codigo_materia=pm.codigo_materia
                     AND pcm.id_ciclo_lectivo=pm.id_ciclo_lectivo
                   LEFT JOIN curso c ON c.id_curso=pcm.id_curso
                     AND c.id_ciclo_lectivo=pcm.id_ciclo_lectivo
                   LEFT JOIN especialidad e ON e.id_especialidad=c.id_especialidad
                   WHERE pm.codigo_materia=m.codigo
                     AND pm.id_ciclo_lectivo=cm.id_ciclo_lectivo
                   GROUP BY pm.dni_profesor
                 ) asignaciones
                 JOIN profesor p ON p.dni=asignaciones.dni_profesor
               ),
               '[]'::json
             ) AS profesores
      FROM ciclo_materia cm
      JOIN materia m ON m.codigo=cm.codigo_materia
      WHERE cm.id_ciclo_lectivo=$1
      ORDER BY m.nombre
    `,
      [cycleId],
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener las materias");
  }
});

app.get("/api/materias/catalogo", auth, roles("admin"), async (req, res) => {
  try {
    const cycleId = await getCycleId(pool, requestedCycleYear(req));
    if (!cycleId) return res.json([]);
    const { rows } = await pool.query(
      `
      SELECT m.codigo, m.nombre, cm.codigo_materia IS NOT NULL AS asignada
      FROM materia m
      LEFT JOIN ciclo_materia cm ON cm.codigo_materia=m.codigo
        AND cm.id_ciclo_lectivo=$1
      ORDER BY m.nombre, m.codigo
    `,
      [cycleId],
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudo obtener el catálogo de materias");
  }
});

app.post(
  "/api/materias/:codigo/asignacion",
  auth,
  roles("admin"),
  async (req, res) => {
    const { codigo } = req.params;
    if (!/^[A-Z0-9_-]{2,20}$/.test(codigo))
      return fail(res, 400, "El código de la materia no es válido");
    try {
      const cycleId = await getCycleId(pool, requestedCycleYear(req));
      if (!cycleId)
        return fail(res, 400, "No hay un ciclo lectivo seleccionado");
      const { rows } = await pool.query(
        `
        INSERT INTO ciclo_materia (id_ciclo_lectivo, codigo_materia)
        SELECT $1, codigo
        FROM materia
        WHERE codigo=$2
        ON CONFLICT (id_ciclo_lectivo, codigo_materia) DO NOTHING
        RETURNING codigo_materia
      `,
        [cycleId, codigo],
      );
      const exists = rows[0] ||
        (await pool.query(
          "SELECT codigo_materia FROM ciclo_materia WHERE id_ciclo_lectivo=$1 AND codigo_materia=$2",
          [cycleId, codigo],
        )).rows[0];
      if (!exists) return fail(res, 404, "Materia no encontrada");
      res.json({ ok: true });
    } catch (error) {
      console.error(error);
      fail(res, 400, "No se pudo asignar la materia al ciclo lectivo");
    }
  },
);

app.post("/api/materias", auth, roles("admin"), async (req, res) => {
  const codigo =
    typeof req.body.codigo === "string"
      ? req.body.codigo.trim().toUpperCase()
      : "";
  const nombre =
    typeof req.body.nombre === "string" ? req.body.nombre.trim() : "";

  if (!/^[A-Z0-9_-]{2,20}$/.test(codigo)) {
    return fail(
      res,
      400,
      "El código debe tener entre 2 y 20 letras, números, guiones o guiones bajos",
    );
  }
  if (!nombre || nombre.length > 100)
    return fail(res, 400, "El nombre de la materia no es válido");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cycleId = await getCycleId(client, requestedCycleYear(req));
    if (!cycleId) {
      await client.query("ROLLBACK");
      return fail(res, 400, "No hay un ciclo lectivo seleccionado");
    }
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended(LOWER(BTRIM($1)), 0))",
      [nombre],
    );
    const { rows: existingName } = await client.query(
      `
      SELECT codigo, nombre
      FROM materia
      WHERE LOWER(BTRIM(nombre))=LOWER(BTRIM($1))
      ORDER BY codigo
      LIMIT 1
      FOR UPDATE
    `,
      [nombre],
    );
    if (existingName[0]) {
      await client.query(
        `
        INSERT INTO ciclo_materia (id_ciclo_lectivo, codigo_materia)
        VALUES ($1,$2)
        ON CONFLICT (id_ciclo_lectivo, codigo_materia) DO NOTHING
      `,
        [cycleId, existingName[0].codigo],
      );
      await client.query("COMMIT");
      return res.json({ ...existingName[0], profesores: [], reutilizada: true });
    }
    const { rows } = await client.query(
      `
      INSERT INTO materia (codigo, nombre)
      VALUES ($1,$2)
      RETURNING codigo, nombre
    `,
      [codigo, nombre],
    );
    await client.query(
      `
      INSERT INTO ciclo_materia (id_ciclo_lectivo, codigo_materia)
      VALUES ($1,$2)
    `,
      [cycleId, rows[0].codigo],
    );
    await client.query("COMMIT");
    res.status(201).json({ ...rows[0], profesores: [] });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505")
      return fail(res, 409, "Ya existe una materia con ese código");
    console.error(error);
    fail(res, 400, "No se pudo crear la materia");
  } finally {
    client.release();
  }
});

app.put("/api/materias/:codigo", auth, roles("admin"), async (req, res) => {
  const { codigo } = req.params;
  const nombre =
    typeof req.body.nombre === "string" ? req.body.nombre.trim() : "";

  if (!/^[A-Z0-9_-]{2,20}$/.test(codigo))
    return fail(res, 400, "El código de la materia no es válido");
  if (!nombre || nombre.length > 100)
    return fail(res, 400, "El nombre de la materia no es válido");

  try {
    const duplicate = await pool.query(
      `
      SELECT codigo
      FROM materia
      WHERE LOWER(BTRIM(nombre))=LOWER(BTRIM($1)) AND codigo<>$2
      LIMIT 1
    `,
      [nombre, codigo],
    );
    if (duplicate.rows[0])
      return fail(
        res,
        409,
        `Ya existe la materia ${duplicate.rows[0].codigo}; se reutiliza en todos los ciclos`,
      );
    const { rows } = await pool.query(
      `
      UPDATE materia
      SET nombre=$2
      WHERE codigo=$1
      RETURNING codigo, nombre
    `,
      [codigo, nombre],
    );
    if (!rows[0]) return fail(res, 404, "Materia no encontrada");
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    fail(res, 400, "No se pudo modificar la materia");
  }
});

app.delete("/api/materias/:codigo", auth, roles("admin"), async (req, res) => {
  const { codigo } = req.params;
  if (!/^[A-Z0-9_-]{2,20}$/.test(codigo))
    return fail(res, 400, "El código de la materia no es válido");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cycleId = await getCycleId(client, requestedCycleYear(req));
    if (!cycleId) {
      await client.query("ROLLBACK");
      return fail(res, 400, "No hay un ciclo lectivo seleccionado");
    }
    const subjectResult = await client.query(
      "SELECT codigo FROM materia WHERE codigo=$1 FOR UPDATE",
      [codigo],
    );
    if (!subjectResult.rows[0]) {
      await client.query("ROLLBACK");
      return fail(res, 404, "Materia no encontrada");
    }
    const assignmentResult = await client.query(
      "SELECT codigo_materia FROM ciclo_materia WHERE codigo_materia=$1 AND id_ciclo_lectivo=$2 FOR UPDATE",
      [codigo, cycleId],
    );
    if (!assignmentResult.rows[0]) {
      await client.query("ROLLBACK");
      return fail(res, 404, "Materia no encontrada");
    }

    const { rows } = await client.query(
      `
      SELECT
        EXISTS(SELECT 1 FROM profesor_curso_materia WHERE codigo_materia=$1 AND id_ciclo_lectivo=$2) AS tiene_profesores,
        EXISTS(SELECT 1 FROM profesor_materia WHERE codigo_materia=$1 AND id_ciclo_lectivo=$2) AS tiene_docentes,
        EXISTS(SELECT 1 FROM curso_materia WHERE codigo_materia=$1 AND id_ciclo_lectivo=$2) AS tiene_cursos,
        EXISTS(SELECT 1 FROM nota WHERE codigo_materia=$1 AND id_ciclo_lectivo=$2)
          OR EXISTS(SELECT 1 FROM nota_individual WHERE codigo_materia=$1 AND id_ciclo_lectivo=$2) AS tiene_notas
    `,
      [codigo, cycleId],
    );
    if (
      rows[0].tiene_profesores ||
      rows[0].tiene_docentes ||
      rows[0].tiene_cursos ||
      rows[0].tiene_notas
    ) {
      await client.query("ROLLBACK");
      return fail(
        res,
        409,
        "No se puede quitar una materia del ciclo porque tiene cursos, profesores o notas asignadas",
      );
    }

    await client.query(
      "DELETE FROM ciclo_materia WHERE codigo_materia=$1 AND id_ciclo_lectivo=$2",
      [codigo, cycleId],
    );
    const remainingAssignments = await client.query(
      "SELECT 1 FROM ciclo_materia WHERE codigo_materia=$1 LIMIT 1",
      [codigo],
    );
    const eliminada = remainingAssignments.rowCount === 0;
    if (eliminada) {
      await client.query("DELETE FROM materia WHERE codigo=$1", [codigo]);
    }
    await client.query("COMMIT");
    res.json({ ok: true, eliminada });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23503") {
      return fail(
        res,
        409,
        "No se puede eliminar una materia con profesores o notas asignadas",
      );
    }
    console.error(error);
    fail(res, 400, "No se pudo eliminar la materia");
  } finally {
    client.release();
  }
});

app.get("/api/notas", auth, async (req, res) => {
  try {
    const { curso, materia } = req.query;
    const cicloLectivo = Number(req.query.ciclo_lectivo) || null;
    const params = [cicloLectivo];
    let where =
      "ac.fecha_baja IS NULL AND cl.anio = COALESCE($1::integer, (SELECT MAX(anio) FROM ciclo_lectivo))";

    if (curso) {
      params.push(curso);
      where += ` AND ac.id_curso=$${params.length}`;
    }
    if (materia) {
      params.push(materia);
      where += ` AND n.codigo_materia=$${params.length}`;
    }
    if (req.user.rol === "profesor") {
      if (!req.user.dni_profesor)
        return fail(res, 403, "El usuario no tiene un docente asignado");
      params.push(req.user.dni_profesor);
      where += ` AND EXISTS (
        SELECT 1
        FROM profesor_curso_materia pcm
        WHERE pcm.dni_profesor=$${params.length}
          AND pcm.id_curso=ac.id_curso
          AND pcm.id_ciclo_lectivo=ac.id_ciclo_lectivo
          AND pcm.codigo_materia=n.codigo_materia
      )`;
    }

    const { rows } = await pool.query(
      `
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
    `,
      params,
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener las notas");
  }
});

async function notifyStudentGradeChange(
  dniAlumno,
  titulo,
  mensaje,
  idCicloLectivo,
) {
  const { rows } = await pool.query(
    "SELECT anio FROM ciclo_lectivo WHERE id_ciclo_lectivo=$1",
    [idCicloLectivo],
  );
  if (!rows[0])
    throw new Error("No se encontró el ciclo lectivo de la calificación");
  await pool.query(
    `
    INSERT INTO notificacion_alumno (dni_alumno, titulo, mensaje)
    VALUES ($1, $2, $3)
  `,
    [dniAlumno, titulo, `Ciclo lectivo ${rows[0].anio}: ${mensaje}`],
  );
}

app.post(
  "/api/notas",
  auth,
  roles("admin", "profesor", "preceptor"),
  async (req, res) => {
    const {
      dni_alumno,
      codigo_materia,
      tipo_evaluacion,
      calificacion,
      observacion,
      fecha,
      ciclo_lectivo,
    } = req.body;

    if (
      !dni_alumno ||
      !codigo_materia ||
      !tipo_evaluacion ||
      calificacion == null
    ) {
      return fail(res, 400, "Faltan datos de la nota");
    }
    if (Number(calificacion) < 1 || Number(calificacion) > 10) {
      return fail(res, 400, "La calificación debe estar entre 1 y 10");
    }

    try {
      const dniProfesor = req.user.dni_profesor || null;
      const enrollment = await pool.query(
        `
      SELECT ac.id_curso, ac.id_ciclo_lectivo
      FROM alumno_curso ac
      JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=ac.id_ciclo_lectivo
      WHERE ac.dni_alumno=$1
        AND ac.fecha_baja IS NULL
        AND cl.anio=COALESCE($2::integer, (SELECT MAX(anio) FROM ciclo_lectivo))
      LIMIT 1
    `,
        [dni_alumno, requestedCycleYear(req) || Number(ciclo_lectivo) || null],
      );
      if (!enrollment.rows[0]) {
        return fail(
          res,
          400,
          "El alumno no tiene curso asignado en ese ciclo lectivo",
        );
      }
      const { id_curso, id_ciclo_lectivo } = enrollment.rows[0];
      if (req.user.rol === "profesor") {
        const assignment = await pool.query(
          `
        SELECT 1
        FROM profesor_curso_materia
        WHERE dni_profesor=$1
          AND id_curso=$2
          AND id_ciclo_lectivo=$3
          AND codigo_materia=$4
      `,
          [req.user.dni_profesor, id_curso, id_ciclo_lectivo, codigo_materia],
        );
        if (!assignment.rows[0]) {
          return fail(
            res,
            403,
            "No tenés asignada esa materia para este curso",
          );
        }
      }
      const { rows } = await pool.query(
        `
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
    `,
        [
          dni_alumno,
          codigo_materia,
          tipo_evaluacion,
          calificacion,
          observacion || null,
          fecha || null,
          dniProfesor,
          id_curso,
          id_ciclo_lectivo,
        ],
      );

      if (req.body.notificar_alumno !== false) {
        const materiaResult = await pool.query(
          "SELECT nombre FROM materia WHERE codigo=$1",
          [codigo_materia],
        );
        await notifyStudentGradeChange(
          dni_alumno,
          "Actualización de calificaciones",
          `${materiaResult.rows[0]?.nombre || "Una materia"}: se actualizó la calificación de ${tipo_evaluacion.replaceAll("_", " ")}. Nota: ${rows[0].calificacion}.`,
          id_ciclo_lectivo,
        );
      }
      res.status(201).json(rows[0]);
    } catch (error) {
      console.error(error);
      fail(res, 400, "No se pudo guardar la nota");
    }
  },
);

app.delete(
  "/api/notas",
  auth,
  roles("admin", "profesor", "preceptor"),
  async (req, res) => {
    const { dni_alumno, codigo_materia, tipo_evaluacion, ciclo_lectivo } =
      req.body;
    if (!dni_alumno || !codigo_materia || !tipo_evaluacion) {
      return fail(res, 400, "Faltan datos para eliminar la nota");
    }

    try {
      const enrollment = await pool.query(
        `
      SELECT ac.id_curso, ac.id_ciclo_lectivo
      FROM alumno_curso ac
      JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=ac.id_ciclo_lectivo
      WHERE ac.dni_alumno=$1
        AND ac.fecha_baja IS NULL
        AND cl.anio=COALESCE($2::integer, (SELECT MAX(anio) FROM ciclo_lectivo))
      LIMIT 1
    `,
        [dni_alumno, requestedCycleYear(req) || Number(ciclo_lectivo) || null],
      );
      if (!enrollment.rows[0]) {
        return fail(
          res,
          400,
          "El alumno no tiene curso asignado en ese ciclo lectivo",
        );
      }
      const { id_curso, id_ciclo_lectivo } = enrollment.rows[0];

      if (req.user.rol === "profesor") {
        const assignment = await pool.query(
          `
        SELECT 1
        FROM profesor_curso_materia
        WHERE dni_profesor=$1
          AND id_curso=$2
          AND id_ciclo_lectivo=$3
          AND codigo_materia=$4
      `,
          [req.user.dni_profesor, id_curso, id_ciclo_lectivo, codigo_materia],
        );
        if (!assignment.rows[0]) {
          return fail(
            res,
            403,
            "No tenés asignada esa materia para este curso",
          );
        }
      }

      const { rows } = await pool.query(
        `
      DELETE FROM nota
      WHERE dni_alumno=$1
        AND id_curso=$2
        AND id_ciclo_lectivo=$3
        AND codigo_materia=$4
        AND tipo_evaluacion=$5
      RETURNING calificacion
    `,
        [
          dni_alumno,
          id_curso,
          id_ciclo_lectivo,
          codigo_materia,
          tipo_evaluacion,
        ],
      );

      if (rows[0]) {
        const materiaResult = await pool.query(
          "SELECT nombre FROM materia WHERE codigo=$1",
          [codigo_materia],
        );
        await notifyStudentGradeChange(
          dni_alumno,
          "Actualización de calificaciones",
          `Se eliminó la calificación de ${materiaResult.rows[0]?.nombre || "una materia"} para ${tipo_evaluacion.replaceAll("_", " ")}. Nota anterior: ${rows[0].calificacion}.`,
          id_ciclo_lectivo,
        );
      }
      res.json({ ok: true });
    } catch (error) {
      console.error(error);
      fail(res, 400, "No se pudo eliminar la nota");
    }
  },
);

const PERIODOS_NOTA_INDIVIDUAL = new Set([
  "BIMESTRE_1",
  "BIMESTRE_2",
  "BIMESTRE_3",
  "BIMESTRE_4",
  "DICIEMBRE",
  "FEBRERO",
]);

function validateNotaIndividual(body) {
  if (!body || typeof body !== "object")
    return "Los datos de la evaluación individual no son válidos";
  const calificacion = Number(body.calificacion);
  if (
    !body.dni_alumno ||
    !body.codigo_materia ||
    !PERIODOS_NOTA_INDIVIDUAL.has(body.tipo_evaluacion)
  ) {
    return "Faltan datos de la evaluación individual";
  }
  if (typeof body.tema !== "string" || !body.tema.trim())
    return "Ingresá el tema de la evaluación";
  if (!["No realizó", "Entregado"].includes(body.estado))
    return "El estado de la evaluación no es válido";
  if (!Number.isFinite(calificacion) || calificacion < 1 || calificacion > 10) {
    return "La calificación debe estar entre 1 y 10";
  }
  if (body.estado === "No realizó" && calificacion !== 1) {
    return "Si no realizó la actividad, la calificación debe ser 1";
  }
  if (calificacion < 6 && typeof body.adeuda !== "boolean") {
    return "Indicá si adeuda el tema";
  }
  return null;
}

async function getNotaIndividualEnrollment(dniAlumno, idCurso, cycleYear) {
  const { rows } = await pool.query(
    `
    SELECT ac.id_curso, ac.id_ciclo_lectivo
    FROM alumno_curso ac
    JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=ac.id_ciclo_lectivo
    WHERE ac.dni_alumno=$1
      AND ac.id_curso=$2
      AND ac.fecha_baja IS NULL
      AND cl.anio=COALESCE($3::integer, (SELECT MAX(anio) FROM ciclo_lectivo))
    LIMIT 1
  `,
    [dniAlumno, idCurso, cycleYear],
  );
  return rows[0];
}

async function canManageIndividualGrade(req, enrollment, codigoMateria) {
  if (req.user.rol !== "profesor") return true;
  if (!req.user.dni_profesor) return false;
  const { rows } = await pool.query(
    `
    SELECT 1
    FROM profesor_curso_materia
    WHERE dni_profesor=$1
      AND id_curso=$2
      AND id_ciclo_lectivo=$3
      AND codigo_materia=$4
  `,
    [
      req.user.dni_profesor,
      enrollment.id_curso,
      enrollment.id_ciclo_lectivo,
      codigoMateria,
    ],
  );
  return Boolean(rows[0]);
}

app.get(
  "/api/notas-individuales",
  auth,
  roles("admin", "profesor", "preceptor"),
  async (req, res) => {
    const { curso, materia, dni } = req.query;
    if (!curso || !materia || !dni) {
      return fail(
        res,
        400,
        "Faltan filtros para consultar las evaluaciones individuales",
      );
    }
    try {
      const enrollment = await getNotaIndividualEnrollment(
        dni,
        curso,
        requestedCycleYear(req),
      );
      if (!enrollment)
        return fail(
          res,
          404,
          "El alumno no tiene curso asignado en el ciclo lectivo actual",
        );
      if (!(await canManageIndividualGrade(req, enrollment, materia))) {
        return fail(res, 403, "No tenés asignada esa materia para este curso");
      }
      const { rows } = await pool.query(
        `
      SELECT id_nota_individual, dni_alumno, id_curso, id_ciclo_lectivo,
             codigo_materia, tipo_evaluacion, tema, estado, calificacion, adeuda,
             fecha, dni_profesor
      FROM nota_individual
      WHERE dni_alumno=$1
        AND id_curso=$2
        AND id_ciclo_lectivo=$3
        AND codigo_materia=$4
      ORDER BY fecha DESC, id_nota_individual DESC
    `,
        [dni, enrollment.id_curso, enrollment.id_ciclo_lectivo, materia],
      );
      res.json(rows);
    } catch (error) {
      console.error(error);
      fail(res, 500, "No se pudieron obtener las evaluaciones individuales");
    }
  },
);

app.post(
  "/api/notas-individuales",
  auth,
  roles("admin", "profesor", "preceptor"),
  async (req, res) => {
    const validationError = validateNotaIndividual(req.body);
    if (validationError) return fail(res, 400, validationError);
    try {
      const enrollment = await getNotaIndividualEnrollment(
        req.body.dni_alumno,
        req.body.id_curso,
        requestedCycleYear(req),
      );
      if (!enrollment)
        return fail(
          res,
          400,
          "El alumno no tiene curso asignado en el ciclo lectivo actual",
        );
      if (
        !(await canManageIndividualGrade(
          req,
          enrollment,
          req.body.codigo_materia,
        ))
      ) {
        return fail(res, 403, "No tenés asignada esa materia para este curso");
      }
      const { rows } = await pool.query(
        `
      INSERT INTO nota_individual
        (dni_alumno,id_curso,id_ciclo_lectivo,codigo_materia,tipo_evaluacion,tema,estado,calificacion,adeuda,dni_profesor)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `,
        [
          req.body.dni_alumno,
          enrollment.id_curso,
          enrollment.id_ciclo_lectivo,
          req.body.codigo_materia,
          req.body.tipo_evaluacion,
          req.body.tema.trim(),
          req.body.estado,
          Number(req.body.calificacion),
          Number(req.body.calificacion) < 6 ? req.body.adeuda : null,
          req.user.dni_profesor || null,
        ],
      );
      if (req.body.notificar_alumno !== false) {
        const materiaResult = await pool.query(
          "SELECT nombre FROM materia WHERE codigo=$1",
          [req.body.codigo_materia],
        );
        await notifyStudentGradeChange(
          req.body.dni_alumno,
          "Nueva nota individual",
          `${materiaResult.rows[0]?.nombre || "Una materia"}: se registró "${req.body.tema.trim()}" en ${req.body.tipo_evaluacion.replaceAll("_", " ")}. Nota: ${Number(req.body.calificacion)}.${Number(req.body.calificacion) < 6 ? ` Adeuda el tema: ${req.body.adeuda ? "Sí" : "No"}.` : ""}`,
          enrollment.id_ciclo_lectivo,
        );
      }
      res.status(201).json(rows[0]);
    } catch (error) {
      console.error(error);
      fail(res, 400, "No se pudo guardar la evaluación individual");
    }
  },
);

app.put(
  "/api/notas-individuales/:id",
  auth,
  roles("admin", "profesor", "preceptor"),
  async (req, res) => {
    const validationError = validateNotaIndividual(req.body);
    if (validationError) return fail(res, 400, validationError);
    try {
      const enrollment = await getNotaIndividualEnrollment(
        req.body.dni_alumno,
        req.body.id_curso,
        requestedCycleYear(req),
      );
      if (!enrollment)
        return fail(
          res,
          400,
          "El alumno no tiene curso asignado en el ciclo lectivo actual",
        );
      if (
        !(await canManageIndividualGrade(
          req,
          enrollment,
          req.body.codigo_materia,
        ))
      ) {
        return fail(res, 403, "No tenés asignada esa materia para este curso");
      }
      const { rows } = await pool.query(
        `
      UPDATE nota_individual
      SET tipo_evaluacion=$1, tema=$2, estado=$3, calificacion=$4, adeuda=$5,
          fecha=CURRENT_DATE, dni_profesor=$6
      WHERE id_nota_individual=$7
        AND dni_alumno=$8
        AND id_curso=$9
        AND id_ciclo_lectivo=$10
        AND codigo_materia=$11
      RETURNING *
    `,
        [
          req.body.tipo_evaluacion,
          req.body.tema.trim(),
          req.body.estado,
          Number(req.body.calificacion),
          Number(req.body.calificacion) < 6 ? req.body.adeuda : null,
          req.user.dni_profesor || null,
          req.params.id,
          req.body.dni_alumno,
          enrollment.id_curso,
          enrollment.id_ciclo_lectivo,
          req.body.codigo_materia,
        ],
      );
      if (!rows[0])
        return fail(res, 404, "No se encontró la evaluación individual");
      if (req.body.notificar_alumno !== false) {
        const materiaResult = await pool.query(
          "SELECT nombre FROM materia WHERE codigo=$1",
          [req.body.codigo_materia],
        );
        await notifyStudentGradeChange(
          req.body.dni_alumno,
          "Nota individual actualizada",
          `${materiaResult.rows[0]?.nombre || "Una materia"}: se actualizó "${req.body.tema.trim()}" en ${req.body.tipo_evaluacion.replaceAll("_", " ")}. Nota: ${Number(req.body.calificacion)}.${Number(req.body.calificacion) < 6 ? ` Adeuda el tema: ${req.body.adeuda ? "Sí" : "No"}.` : ""}`,
          enrollment.id_ciclo_lectivo,
        );
      }
      res.json(rows[0]);
    } catch (error) {
      console.error(error);
      fail(res, 400, "No se pudo actualizar la evaluación individual");
    }
  },
);

app.delete(
  "/api/notas-individuales/:id",
  auth,
  roles("admin", "profesor", "preceptor"),
  async (req, res) => {
    const { dni_alumno, id_curso, codigo_materia } = req.body;
    if (!dni_alumno || !id_curso || !codigo_materia) {
      return fail(
        res,
        400,
        "Faltan datos para eliminar la evaluación individual",
      );
    }
    try {
      const enrollment = await getNotaIndividualEnrollment(
        dni_alumno,
        id_curso,
        requestedCycleYear(req),
      );
      if (!enrollment)
        return fail(
          res,
          400,
          "El alumno no tiene curso asignado en el ciclo lectivo actual",
        );
      if (!(await canManageIndividualGrade(req, enrollment, codigo_materia))) {
        return fail(res, 403, "No tenés asignada esa materia para este curso");
      }
      const { rows } = await pool.query(
        `
      DELETE FROM nota_individual
      WHERE id_nota_individual=$1
        AND dni_alumno=$2
        AND id_curso=$3
        AND id_ciclo_lectivo=$4
        AND codigo_materia=$5
      RETURNING tema, tipo_evaluacion, calificacion, adeuda
    `,
        [
          req.params.id,
          dni_alumno,
          enrollment.id_curso,
          enrollment.id_ciclo_lectivo,
          codigo_materia,
        ],
      );
      if (!rows[0])
        return fail(res, 404, "No se encontró la evaluación individual");
      const materiaResult = await pool.query(
        "SELECT nombre FROM materia WHERE codigo=$1",
        [codigo_materia],
      );
      await notifyStudentGradeChange(
        dni_alumno,
        "Nota individual eliminada",
        `${materiaResult.rows[0]?.nombre || "Una materia"}: se eliminó "${rows[0].tema}" de ${rows[0].tipo_evaluacion.replaceAll("_", " ")}. Nota anterior: ${Number(rows[0].calificacion)}.${Number(rows[0].calificacion) < 6 ? ` Adeudaba el tema: ${rows[0].adeuda == null ? "No indicado" : rows[0].adeuda ? "Sí" : "No"}.` : ""}`,
        enrollment.id_ciclo_lectivo,
      );
      res.json({ ok: true });
    } catch (error) {
      console.error(error);
      fail(res, 400, "No se pudo eliminar la evaluación individual");
    }
  },
);

app.get("/api/mis-notas", auth, roles("alumno"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT m.codigo AS codigo, m.nombre AS materia,
             MAX(n.calificacion) FILTER (WHERE n.tipo_evaluacion='BIMESTRE_1') AS bim1,
             MAX(n.calificacion) FILTER (WHERE n.tipo_evaluacion='BIMESTRE_2') AS bim2,
             MAX(n.calificacion) FILTER (WHERE n.tipo_evaluacion='CUATRIMESTRE_1') AS cuat1,
             MAX(n.calificacion) FILTER (WHERE n.tipo_evaluacion='FINAL') AS final
      FROM materia m
      JOIN nota n ON n.codigo_materia=m.codigo
      JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=n.id_ciclo_lectivo
      WHERE n.dni_alumno=$1
        AND cl.anio=COALESCE($2::integer, (SELECT MAX(anio) FROM ciclo_lectivo))
      GROUP BY m.codigo, m.nombre
      ORDER BY m.nombre
    `,
      [req.user.dni_alumno, requestedCycleYear(req)],
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener tus calificaciones");
  }
});

app.get("/api/notificaciones", auth, async (req, res) => {
  try {
    if (req.user.rol === "alumno") {
      const { rows } = await pool.query(
        `
        SELECT id_notificacion, titulo, mensaje, fecha, 'Informe' AS tipo
        FROM notificacion_alumno
        WHERE dni_alumno=$1
        ORDER BY fecha DESC, id_notificacion DESC
        LIMIT 100
      `,
        [req.user.dni_alumno],
      );
      return res.json(rows);
    }
    const { rows } = await pool.query(
      `
      SELECT n.id_nota, a.nombre, a.apellido, m.nombre AS materia,
             n.calificacion, n.tipo_evaluacion, n.fecha,
             CASE WHEN n.calificacion < 6 THEN 'Crítica' ELSE 'Informe' END AS tipo
      FROM nota n
      JOIN alumno a ON a.dni=n.dni_alumno
      JOIN materia m ON m.codigo=n.codigo_materia
      JOIN ciclo_lectivo cl ON cl.id_ciclo_lectivo=n.id_ciclo_lectivo
      WHERE cl.anio=COALESCE($1::integer, (SELECT MAX(anio) FROM ciclo_lectivo))
      ORDER BY n.fecha DESC, n.id_nota DESC
      LIMIT 50
    `,
      [requestedCycleYear(req)],
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener las notificaciones");
  }
});

async function ensureRole(name, description) {
  await pool.query(
    "INSERT INTO rol(nombre, descripcion) VALUES($1,$2) ON CONFLICT(nombre) DO NOTHING",
    [name, description],
  );
}

async function ensureRoles() {
  await Promise.all([
    ensureRole("admin", "Autoridad / Administrador"),
    ensureRole("profesor", "Profesor / Docente"),
    ensureRole("alumno", "Alumno"),
    ensureRole("preceptor", "Preceptor"),
  ]);
}

const distPath = path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distPath, "index.html"));
  });
}

let httpServer;

async function start() {
  try {
    await pool.query("SELECT 1");
    await ensureRoles();
    httpServer = app.listen(PORT, () => {
      console.log(`Backend escuchando en el puerto ${PORT}`);
      if (fs.existsSync(distPath)) {
        console.log("Frontend compilado disponible desde el servidor");
      }
    });
    httpServer.on("error", (error) => {
      console.error("No se pudo iniciar el servidor HTTP:", error);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error("No se pudo iniciar el backend:", error.message);
    await pool.end();
    process.exitCode = 1;
  }
}

async function shutdown(signal) {
  console.log(`Cerrando el servidor (${signal})...`);
  clearInterval(tokenCleanup);
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  await pool.end();
}

process.once("SIGTERM", () =>
  shutdown("SIGTERM").catch((error) => {
    console.error("Error al cerrar el servidor:", error);
    process.exitCode = 1;
  }),
);
process.once("SIGINT", () =>
  shutdown("SIGINT").catch((error) => {
    console.error("Error al cerrar el servidor:", error);
    process.exitCode = 1;
  }),
);

start();
