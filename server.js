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
  if (session.user.rol === "preceptor") {
    try {
      const result = await pool.query(
        "SELECT 1 FROM preceptor WHERE dni=$1 AND estado='Activo'", [session.user.dni_preceptor],
      );
      if (!result.rowCount) {
        tokens.delete(token);
        return fail(res, 401, "No autenticado");
      }
    } catch (error) {
      return next(error);
    }
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

const PRECEPTOR_PERMISSIONS = new Set([
  "alumnos.editar_datos",
  "alumnos.cambiar_estado",
  "docentes.editar_datos",
  "docentes.cambiar_estado",
  "notas.editar",
]);

async function hasPreceptorPermission(user, permission) {
  if (user.rol === "admin") return true;
  if (user.rol !== "preceptor" || !user.dni_preceptor) return false;
  const { rows } = await pool.query(
    "SELECT 1 FROM preceptor_permiso WHERE dni_preceptor=$1 AND codigo=$2",
    [user.dni_preceptor, permission],
  );
  return Boolean(rows[0]);
}

async function hasPreceptorStudentScope(db, user, dni, year) {
  if (user.rol === "admin") return true;
  const cycleId = await getCycleId(db, year);
  const result = await db.query(
    `SELECT 1 FROM alumno_curso ac JOIN preceptor_curso_materia scope
       ON scope.id_curso=ac.id_curso AND scope.id_ciclo_lectivo=ac.id_ciclo_lectivo
     WHERE ac.dni_alumno=$1 AND ac.id_ciclo_lectivo=$2 AND ac.fecha_baja IS NULL
       AND scope.dni_preceptor=$3 LIMIT 1`,
    [dni, cycleId, user.dni_preceptor],
  );
  return result.rowCount > 0;
}

async function hasPreceptorTeacherScope(user, dni, year) {
  if (user.rol === "admin") return true;
  const cycleId = await getCycleId(pool, year);
  const result = await pool.query(
    `SELECT 1 FROM profesor_curso_materia pcm
     JOIN preceptor_curso_materia scope USING (id_curso, codigo_materia, id_ciclo_lectivo)
     JOIN profesor titular ON titular.dni=pcm.dni_profesor
     WHERE pcm.id_ciclo_lectivo=$1 AND scope.dni_preceptor=$2
       AND (titular.dni=$3 OR (titular.estado='Licencia' AND titular.dni_suplente=$3))
     LIMIT 1`,
    [cycleId, user.dni_preceptor, dni],
  );
  return result.rowCount > 0;
}

function requestError(status, message) {
  return Object.assign(new Error(message), { status });
}

function validSubjectCode(code) {
  return typeof code === "string" && /^[A-Z0-9_-]{2,20}$/.test(code);
}

function validateCourseSubjects(codes) {
  if (!Array.isArray(codes) || codes.some((code) => !validSubjectCode(code)))
    throw requestError(400, "La lista de materias no es válida");
  if (new Set(codes).size !== codes.length)
    throw requestError(400, "No se pueden repetir materias en un curso");
}

async function lockPlan(db, id) {
  if (!Number.isInteger(id) || id < 1)
    throw requestError(400, "Seleccioná un plan de estudio");
  const { rows } = await db.query(
    "SELECT * FROM plan_estudio WHERE id_plan_estudio=$1 FOR SHARE",
    [id],
  );
  if (!rows[0]) throw requestError(400, "El plan de estudio no existe");
  return rows[0];
}

function planAllowsYear(plan, year) {
  return Number.isInteger(year) && year >= 1 && year <= 6 &&
    (year <= 2 ? plan.ciclo === "Básico" : plan.ciclo === "Superior");
}

async function validatePlanSubjects(db, planId, year, codes) {
  const { rows } = await db.query(
    `SELECT codigo_materia FROM plan_estudio_materia
     WHERE id_plan_estudio=$1 AND anio=$2 AND codigo_materia=ANY($3::varchar[])`,
    [planId, year, codes],
  );
  if (rows.length !== codes.length)
    throw requestError(400, "Hay materias que no pertenecen al plan y año del curso");
}

async function addCourseSubjects(db, course, codes) {
  await db.query(
    `INSERT INTO ciclo_materia (id_ciclo_lectivo, codigo_materia)
     SELECT $1, codigo FROM unnest($2::varchar[]) AS subject(codigo)
     ON CONFLICT DO NOTHING`,
    [course.id_ciclo_lectivo, codes],
  );
  await db.query(
    `INSERT INTO curso_materia (id_curso, id_ciclo_lectivo, codigo_materia, id_plan_estudio, anio)
     SELECT $1, $2, codigo, $3, $4 FROM unnest($5::varchar[]) AS subject(codigo)
     ON CONFLICT DO NOTHING`,
    [course.id_curso, course.id_ciclo_lectivo, course.id_plan_estudio, course.anio, codes],
  );
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
    if (!user || (user.estado !== "Activo" && user.rol !== "alumno")) {
      return fail(res, 401, "Usuario o contraseña incorrectos");
    }

    const ok = await bcrypt.compare(contrasenia, user.contrasenia);
    if (!ok) return fail(res, 401, "Usuario o contraseña incorrectos");

    if (user.rol === "alumno" && user.estado !== "Activo") {
      await pool.query(
        "UPDATE usuario SET estado='Activo' WHERE id_usuario=$1",
        [user.id_usuario],
      );
    }

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

app.get("/api/me", auth, async (req, res) => {
  if (req.user.rol !== "preceptor") return res.json({ ...req.user, permisos: [] });
  const { rows } = await pool.query(
    "SELECT codigo FROM preceptor_permiso WHERE dni_preceptor=$1",
    [req.user.dni_preceptor],
  );
  res.json({ ...req.user, permisos: rows.map((row) => row.codigo) });
});

app.get("/api/dashboard", auth, async (req, res) => {
  if (req.user.rol !== "admin") return res.json({ alumnos_activos: 0, calificaciones_cargadas: 0 });
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
    const { rol: role, dni_preceptor: preceptor, dni_profesor: teacher, dni_alumno: student } = req.user;
    const cicloLectivo = Number(req.query.ciclo_lectivo) || null;
    const { rows } = await pool.query(
      `
      SELECT a.dni, a.nombre, a.apellido, a.email, a.estado,
             a.fecha_nacimiento::text AS fecha_nacimiento, a.genero, a.nacionalidad,
             d.calle, d.numero_calle, d.departamento, d.localidad,
             c.id_curso, c.anio, c.division, e.nombre AS especialidad, cl.anio AS ciclo_lectivo,
             CASE WHEN $2='admin' OR $2='alumno' THEN COALESCE(ROUND(AVG(n.calificacion), 2), 0) END AS promedio,
             CASE WHEN $2='admin' OR $2='alumno' THEN ROUND(AVG(n.calificacion), 2) END AS promedio_anio,
             CASE WHEN $2='admin' OR $2='alumno' THEN (SELECT ROUND(AVG(nota_general.calificacion), 2)
              FROM nota nota_general
              WHERE nota_general.dni_alumno=a.dni AND nota_general.tipo_evaluacion<>'DEFINITIVA') END AS promedio_general
      FROM alumno a
      LEFT JOIN domicilio d ON d.id_domicilio=a.id_domicilio
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
        AND n.tipo_evaluacion<>'DEFINITIVA'
      WHERE $2='admin' OR ($2='alumno' AND a.dni=$5)
        OR ($2='preceptor' AND EXISTS (
          SELECT 1 FROM preceptor_curso_materia scope
          WHERE scope.dni_preceptor=$3 AND scope.id_curso=ac.id_curso
            AND scope.id_ciclo_lectivo=ac.id_ciclo_lectivo
        ))
        OR ($2='profesor' AND EXISTS (
          SELECT 1 FROM profesor_curso_materia pcm
          JOIN profesor titular ON titular.dni=pcm.dni_profesor
          JOIN profesor docente ON docente.dni=$4
          WHERE pcm.id_curso=ac.id_curso AND pcm.id_ciclo_lectivo=ac.id_ciclo_lectivo AND (
            (titular.dni=$4 AND titular.estado='Activo')
            OR (titular.dni_suplente=$4 AND titular.estado='Licencia' AND docente.estado='Suplente')
          )
        ))
      GROUP BY a.dni, d.id_domicilio, c.id_curso, e.nombre, cl.anio
      ORDER BY a.apellido, a.nombre
      `,
      [cicloLectivo, role, preceptor, teacher, student],
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener los alumnos");
  }
});

async function getStudentBulletins(dni, cycleYear = null, preceptorDni = null) {
  const { rows } = await pool.query(
    `
    SELECT a.dni, a.nombre, a.apellido, a.fecha_nacimiento::text AS fecha_nacimiento,
           a.genero, a.nacionalidad,
           d.calle, d.numero_calle, d.departamento, d.localidad,
           ac.id_curso, ac.fecha_inscripcion, ac.fecha_baja,
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
    FROM alumno_curso ac
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
      UNION
      SELECT codigo_materia
      FROM nota_individual
      WHERE dni_alumno=ac.dni_alumno AND id_curso=ac.id_curso AND id_ciclo_lectivo=ac.id_ciclo_lectivo
    ) subjects ON TRUE
    LEFT JOIN materia cm ON cm.codigo=subjects.codigo_materia
    WHERE ac.dni_alumno=$1
      AND ($2::integer IS NULL OR cl.anio=$2)
      AND ($3::varchar IS NULL OR EXISTS (
        SELECT 1 FROM preceptor_curso_materia scope
        WHERE scope.dni_preceptor=$3 AND scope.id_curso=ac.id_curso
          AND scope.id_ciclo_lectivo=ac.id_ciclo_lectivo
          AND scope.codigo_materia=subjects.codigo_materia
      ))
    ORDER BY cl.anio DESC, ac.fecha_baja NULLS FIRST, ac.fecha_inscripcion DESC,
             c.anio, c.division, cm.nombre
  `,
    [dni, cycleYear, preceptorDni],
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
        fecha_inscripcion: row.fecha_inscripcion,
        fecha_baja: row.fecha_baja,
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
        grades.push(...subject.notas.filter((note) => note.tipo_evaluacion !== "DEFINITIVA"));
      }
      delete course._subjects;
    }
    allGrades.push(...grades);
    cycle.promedio = grades.length
      ? grades.reduce((sum, grade) => sum + Number(grade.calificacion), 0) /
        grades.length
      : null;
    delete cycle._courses;
  }

  let student = rows[0];
  if (!student && !preceptorDni) {
    const result = await pool.query(
      `SELECT a.*, d.calle, d.numero_calle, d.departamento, d.localidad
       FROM alumno a LEFT JOIN domicilio d USING (id_domicilio) WHERE a.dni=$1`, [dni],
    );
    student = result.rows[0];
  }
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
      const bulletin = await getStudentBulletins(
        dni, requestedCycleYear(req), req.user.rol === "preceptor" ? req.user.dni_preceptor : null,
      );
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

const addressFields = [
  ["calle", 100], ["numero_calle", 10], ["departamento", 50], ["localidad", 80],
];

function readStudentDetails(body) {
  const values = {};
  for (const [field, limit] of [["fecha_nacimiento", 10], ["genero", 30], ["nacionalidad", 60]]) {
    if (!Object.hasOwn(body, field)) continue;
    const value = body[field];
    if (value != null && (typeof value !== "string" || value.trim().length > limit))
      throw requestError(400, "Revisá los datos personales del alumno");
    values[field] = value?.trim() || null;
  }
  if (values.fecha_nacimiento) {
    const input = values.fecha_nacimiento;
    const date = new Date(`${input}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== input || input.slice(0, 4) === "0000" ||
        date > new Date()) {
      throw requestError(400, "La fecha de nacimiento no es válida");
    }
  }
  return values;
}

async function updateStudentDetails(client, dni, details) {
  if (!Object.keys(details).length) return;
  await client.query(
    `UPDATE alumno SET
       fecha_nacimiento=CASE WHEN $2::jsonb ? 'fecha_nacimiento' THEN ($2->>'fecha_nacimiento')::date ELSE fecha_nacimiento END,
       genero=CASE WHEN $2::jsonb ? 'genero' THEN $2->>'genero' ELSE genero END,
       nacionalidad=CASE WHEN $2::jsonb ? 'nacionalidad' THEN $2->>'nacionalidad' ELSE nacionalidad END
     WHERE dni=$1`,
    [dni, details],
  );
}

function readStudentAddress(body) {
  if (!addressFields.some(([field]) => Object.hasOwn(body, field))) return undefined;

  const values = addressFields.map(([field, limit]) => {
    const value = body[field];
    if (value == null) return null;
    if (typeof value !== "string" || value.trim().length > limit)
      throw requestError(400, "Los datos del domicilio no son válidos");
    return value.trim() || null;
  });
  if (!values.some(Boolean)) return null;
  if (!values[0] || !values[3])
    throw requestError(400, "Para registrar un domicilio, la calle y la localidad son obligatorias");
  return values;
}

async function insertAddress(client, address) {
  const { rows } = await client.query(
    `INSERT INTO domicilio (calle, numero_calle, departamento, localidad)
     VALUES ($1,$2,$3,$4) RETURNING id_domicilio`,
    address,
  );
  return rows[0].id_domicilio;
}

async function updateStudentAddress(client, dni, previousId, address) {
  if (address === undefined) return previousId;
  if (previousId) {
    await client.query("SELECT id_domicilio FROM domicilio WHERE id_domicilio=$1 FOR UPDATE", [previousId]);
    const other = await client.query(
      `SELECT 1 FROM alumno WHERE id_domicilio=$1 AND dni<>$2
       UNION ALL SELECT 1 FROM profesor WHERE id_domicilio=$1 LIMIT 1`,
      [previousId, dni],
    );
    if (!other.rowCount && address) {
      await client.query(
        `UPDATE domicilio SET calle=$2, numero_calle=$3, departamento=$4, localidad=$5
         WHERE id_domicilio=$1`,
        [previousId, ...address],
      );
      return previousId;
    }
  }
  const nextId = address ? await insertAddress(client, address) : null;
  await client.query("UPDATE alumno SET id_domicilio=$2 WHERE dni=$1", [dni, nextId]);
  if (previousId) {
    await client.query(
      `DELETE FROM domicilio WHERE id_domicilio=$1
       AND NOT EXISTS (SELECT 1 FROM alumno WHERE id_domicilio=$1)
       AND NOT EXISTS (SELECT 1 FROM profesor WHERE id_domicilio=$1)`,
      [previousId],
    );
  }
  return nextId;
}

app.post(
  "/api/alumnos",
  auth,
  roles("admin"),
  async (req, res) => {
  const body = req.body || {};

    const {
      dni,
      nombre,
      apellido,
      email,
      estado = "Activo",
      id_curso,
    } = body;

    if (!dni || !nombre || !apellido) {
      return fail(res, 400, "DNI, nombre y apellido son obligatorios");
    }
    let address;
    let details;
    try {
      address = readStudentAddress(body);
      details = readStudentDetails(body);
    } catch (error) {
      return fail(res, error.status, error.message);
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const idDomicilio = address ? await insertAddress(client, address) : null;

      const { rows } = await client.query(
        `
        INSERT INTO alumno (dni, nombre, apellido, email, estado, id_domicilio)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        `,
        [dni, nombre, apellido, email || null, estado, idDomicilio],
      );

      await updateStudentDetails(client, dni, details);
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
      res.status(201).json({ ...rows[0], ...details });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);

      if (error.code === "23505") {
        return fail(res, 409, "Ya existe un alumno con ese DNI");
      }

      fail(res, 400, "No se pudo crear el alumno");
    } finally {
      client.release();
    }
  },
);


app.put(
  "/api/alumnos/:dni",
  auth,
  roles("admin"),
  async (req, res) => {
    const dniAnterior = String(req.params.dni || "").trim();
    const body = req.body || {};
    const dniNuevo = String(body.dni ?? dniAnterior).trim();
    let dni = dniAnterior;

    if (
      !/^\d{1,20}$/.test(dniAnterior) ||
      !/^\d{1,20}$/.test(dniNuevo)
    ) {
      return fail(res, 400, "El DNI debe contener entre 1 y 20 números");
    }

    const { nombre, apellido, email, estado, id_curso } = body;

    let address;
    let details;
    try {
      address = readStudentAddress(body);
      details = readStudentDetails(body);
    } catch (error) {
      return fail(res, error.status, error.message);
    }
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      if (dniNuevo !== dniAnterior) {
        const { rows: conflictoUsuario } = await client.query(
          `
          SELECT 1
          FROM usuario
          WHERE (
            nombre_usuario = $1
            OR dni_alumno = $1
            OR dni_profesor = $1
            OR dni_preceptor = $1
            OR dni_administrador = $1
          )
          AND dni_alumno IS DISTINCT FROM $2
          LIMIT 1
          `,
          [dniNuevo, dniAnterior],
        );

        if (conflictoUsuario[0]) {
          await client.query("ROLLBACK");
          return fail(
            res,
            409,
            "El nuevo DNI ya está siendo utilizado por otra cuenta",
          );
        }
      }

      const { rows: alumnoActual } = await client.query(
        "SELECT estado, id_domicilio FROM alumno WHERE dni=$1 FOR UPDATE",
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
      SET dni=$2,
      nombre=COALESCE($3,nombre),
      apellido=COALESCE($4,apellido),
      email=COALESCE($5,email),
      estado=COALESCE($6,estado)
      WHERE dni=$1
      RETURNING *
    `,
        [dniAnterior, dniNuevo, nombre, apellido, email, estado],
      );

      if (!rows[0]) {
        await client.query("ROLLBACK");
        return fail(res, 404, "Alumno no encontrado");
      }

      dni = dniNuevo;

      if (dniNuevo !== dniAnterior) {
        const nuevaContrasenia = await bcrypt.hash(String(dniNuevo), 10);

        await client.query(
          `UPDATE usuario
          SET nombre_usuario=$2,
              contrasenia=$3
          WHERE dni_alumno=$1`,
          [dniNuevo, dniNuevo, nuevaContrasenia],
        );
      }


      rows[0].id_domicilio = await updateStudentAddress(
        client, dni, alumnoActual[0].id_domicilio, address,
      );

      await updateStudentDetails(client, dni, details);
      Object.assign(rows[0], details);

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
      const account = await syncPersonAccount(
        client,
        dni,
        "alumno",
        "dni_alumno",
        true,
      );

      await client.query("COMMIT");

      if (dniNuevo !== dniAnterior) {
        revokeAccountSessions(account.userId);
      }

      res.json(rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(
        "Error al modificar alumno:",
        error.message,
        error.code,
        error.detail,
      );

        if (error.code === "23505") {
        return fail(
          res,
          409,
          "El DNI ya está registrado o está siendo utilizado por otra cuenta",
        );
      }

      fail(res, 400, "No se pudo modificar el alumno");
    } finally {
      client.release();
    }
  },
);

app.delete(
  "/api/alumnos/:dni",
  auth,
  roles("admin"),
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
    const { rol: role, dni_preceptor: preceptor, dni_profesor: teacher } = req.user;
    const cicloLectivo = requestedCycleYear(req);
    const { rows } = await pool.query(
      `
      SELECT p.dni, p.nombre, p.apellido, p.email, p.telefono, p.estado,
             p.dni_suplente,
             COALESCE((
               SELECT string_agg(DISTINCT m.nombre, ', ')
               FROM profesor_materia pm
               JOIN materia m ON m.codigo=pm.codigo_materia
               JOIN profesor titular ON titular.dni=pm.dni_profesor
               WHERE (
                   (titular.dni=p.dni AND titular.estado IN ('Activo', 'Licencia'))
                   OR (
                     p.estado='Suplente'
                     AND titular.dni_suplente=p.dni
                     AND titular.estado='Licencia'
                   )
                 )
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
                 JOIN profesor titular ON titular.dni=pm.dni_profesor
                 LEFT JOIN profesor_curso_materia pcm ON pcm.dni_profesor=pm.dni_profesor
                   AND pcm.codigo_materia=pm.codigo_materia
                   AND pcm.id_ciclo_lectivo=pm.id_ciclo_lectivo
                 LEFT JOIN curso c2 ON c2.id_curso=pcm.id_curso
                   AND c2.id_ciclo_lectivo=pcm.id_ciclo_lectivo
                 LEFT JOIN especialidad e2 ON e2.id_especialidad=c2.id_especialidad
                 WHERE ($2<>'preceptor' OR EXISTS (
                   SELECT 1 FROM preceptor_curso_materia scope
                   WHERE scope.dni_preceptor=$3 AND scope.id_curso=pcm.id_curso
                     AND scope.codigo_materia=pcm.codigo_materia AND scope.id_ciclo_lectivo=pcm.id_ciclo_lectivo
                 )) AND (
                     (titular.dni=p.dni AND titular.estado IN ('Activo', 'Licencia'))
                     OR (
                       p.estado='Suplente'
                       AND titular.dni_suplente=p.dni
                       AND titular.estado='Licencia'
                     )
                   )
                   AND pm.id_ciclo_lectivo=(
                     SELECT id_ciclo_lectivo FROM ciclo_lectivo WHERE anio=COALESCE($1::integer, (SELECT MAX(anio) FROM ciclo_lectivo)) ORDER BY anio DESC LIMIT 1
                   )
                 GROUP BY pm.codigo_materia, materia.nombre
               ) por_materia
             ), '[]'::json) AS asignaciones
      FROM profesor p
      LEFT JOIN profesor_curso_materia pcm ON EXISTS (
          SELECT 1
          FROM profesor titular
          WHERE titular.dni=pcm.dni_profesor
            AND (
              (titular.dni=p.dni AND titular.estado IN ('Activo', 'Licencia'))
              OR (
                p.estado='Suplente'
                AND titular.dni_suplente=p.dni
                AND titular.estado='Licencia'
              )
            )
        )
        AND pcm.id_ciclo_lectivo=(
          SELECT id_ciclo_lectivo FROM ciclo_lectivo WHERE anio=COALESCE($1::integer, (SELECT MAX(anio) FROM ciclo_lectivo)) ORDER BY anio DESC LIMIT 1
        )
      LEFT JOIN curso c ON c.id_curso=pcm.id_curso AND ($2<>'preceptor' OR EXISTS (
        SELECT 1 FROM preceptor_curso_materia scope
        WHERE scope.dni_preceptor=$3 AND scope.id_curso=pcm.id_curso
          AND scope.codigo_materia=pcm.codigo_materia AND scope.id_ciclo_lectivo=pcm.id_ciclo_lectivo
      ))
      LEFT JOIN especialidad e ON e.id_especialidad=c.id_especialidad
      WHERE $2='admin' OR ($2='profesor' AND p.dni=$4)
        OR ($2='preceptor' AND EXISTS (
          SELECT 1 FROM preceptor_curso_materia scope
          WHERE scope.dni_preceptor=$3 AND scope.id_curso=pcm.id_curso
            AND scope.codigo_materia=pcm.codigo_materia AND scope.id_ciclo_lectivo=pcm.id_ciclo_lectivo
        ))
      GROUP BY p.dni
      ORDER BY p.apellido, p.nombre
    `,
      [cicloLectivo, role, preceptor, teacher],
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener los docentes");
  }
});

const ESTADOS_DOCENTE = new Set(["Activo", "Licencia", "Suplente", "Baja"]);

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
    body.estado === "Licencia" &&
    (!/^\d{1,20}$/.test(String(body.suplente_dni || "")) ||
      String(body.suplente_dni) === String(body.dni))
  )
    return "Seleccioná un docente suplente válido";
  if (body.estado !== "Licencia" && body.suplente_dni != null)
    return "El suplente solo se puede asignar a un docente con licencia";
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
  if (body.estado === "Suplente" && body.asignaciones.length)
    return "Los suplentes heredan las asignaciones del docente en licencia";
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

async function validateTeacherSubstitute(client, body) {
  if (body.estado !== "Licencia") return;
  const { rows } = await client.query(
    "SELECT dni FROM profesor WHERE dni=$1 AND estado='Suplente'",
    [body.suplente_dni],
  );
  if (!rows[0])
    throw new Error("El docente seleccionado no tiene estado Suplente");
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
    const pairs = assignments.flatMap(({ codigo_materia, cursos }) =>
      cursos.map((id) => ({ id: Number(id), codigo_materia })),
    );
    const { rows } = await client.query(
      `SELECT cm.id_curso, cm.codigo_materia
       FROM unnest($2::integer[], $3::varchar[]) AS requested(id_curso, codigo_materia)
       JOIN curso_materia cm USING (id_curso, codigo_materia)
       WHERE cm.id_ciclo_lectivo=$1`,
      [cycleId, pairs.map(({ id }) => id), pairs.map(({ codigo_materia }) => codigo_materia)],
    );
    if (rows.length !== courseSubjectCount)
      throw new Error("Solo se pueden asignar cursos que tengan asignada la materia correspondiente");
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
  roles("admin"),
  async (req, res) => {
    const validationError = validateDocente(req.body);
    if (validationError) return fail(res, 400, validationError);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cycleId = await getCycleId(client, requestedCycleYear(req));
      if (!cycleId) throw new Error("No hay un ciclo lectivo seleccionado");
      const {
        dni,
        nombre,
        apellido,
        email,
        telefono,
        estado,
        asignaciones,
        suplente_dni,
      } = req.body;
      await validateTeacherSubstitute(client, req.body);
      await client.query(
        `
      INSERT INTO profesor (dni,nombre,apellido,email,telefono,estado,dni_suplente)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `,
        [
          dni,
          nombre.trim(),
          apellido.trim(),
          email?.trim() || null,
          telefono?.trim() || null,
          estado,
          estado === "Licencia" ? suplente_dni : null,
        ],
      );
      if (estado !== "Baja")
        await ensurePersonAccount(client, dni, "profesor", "dni_profesor");
      await replaceTeacherAssignments(
        client,
        dni,
        ["Baja", "Suplente"].includes(estado) ? [] : asignaciones,
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
  roles("admin"),
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
      await validateTeacherSubstitute(client, req.body);
      if (req.body.estado !== "Suplente") {
        const { rows: assignedSubstitute } = await client.query(
          "SELECT dni FROM profesor WHERE dni_suplente=$1 AND estado='Licencia' AND dni<>$1 LIMIT 1",
          [dni],
        );
        if (assignedSubstitute[0])
          throw new Error(
            "No se puede cambiar el estado mientras haya docentes en licencia que dependan de este suplente",
          );
      }
      const { rows } = await client.query(
        `
      UPDATE profesor
      SET nombre=$2, apellido=$3, email=$4, telefono=$5, estado=$6,
          dni_suplente=$7
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
          req.body.estado === "Licencia" ? req.body.suplente_dni : null,
        ],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return fail(res, 404, "Docente no encontrado");
      }
      await replaceTeacherAssignments(
        client,
        dni,
        ["Baja", "Suplente"].includes(req.body.estado)
          ? []
          : req.body.asignaciones,
        cycleId,
      );
      const account = await syncPersonAccount(
        client,
        dni,
        "profesor",
        "dni_profesor",
        req.body.estado !== "Baja",
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
  roles("admin"),
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
        EXISTS(SELECT 1 FROM nota_individual WHERE dni_profesor=$1) AS tiene_notas_individuales,
        EXISTS(SELECT 1 FROM profesor WHERE dni_suplente=$1 AND estado='Licencia') AS es_suplente_activo
    `,
        [dni],
      );
      if (rows[0].es_suplente_activo) {
        await client.query("ROLLBACK");
        return fail(
          res,
          409,
          "No se puede eliminar un suplente mientras haya docentes en licencia que dependan de él",
        );
      }
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

app.get("/api/preceptores/:dni/permisos", auth, roles("admin"), async (req, res) => {
  const { rows } = await pool.query(
    "SELECT codigo FROM preceptor_permiso WHERE dni_preceptor=$1 ORDER BY codigo",
    [req.params.dni],
  );
  res.json(rows.map((row) => row.codigo));
});

async function listPreceptorAssignments(dni, year) {
  const cycleId = await getCycleId(pool, year);
  const { rows } = await pool.query(
    `SELECT id_curso, codigo_materia FROM preceptor_curso_materia
     WHERE dni_preceptor=$1 AND id_ciclo_lectivo=$2 ORDER BY id_curso, codigo_materia`,
    [dni, cycleId],
  );
  return rows;
}

app.get("/api/preceptor-asignaciones", auth, roles("preceptor"), async (req, res, next) => {
  try {
    res.json(await listPreceptorAssignments(req.user.dni_preceptor, requestedCycleYear(req)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/preceptores/:dni/asignaciones", auth, roles("admin"), async (req, res, next) => {
  try {
    res.json(await listPreceptorAssignments(req.params.dni, requestedCycleYear(req)));
  } catch (error) {
    next(error);
  }
});

app.put("/api/preceptores/:dni/permisos", auth, roles("admin"), async (req, res) => {
  const { permisos, asignaciones } = req.body || {};
  if (!Array.isArray(permisos) || permisos.some((item) => !PRECEPTOR_PERMISSIONS.has(item)))
    return fail(res, 400, "La lista de permisos no es válida");
  if (asignaciones !== undefined && (!Array.isArray(asignaciones) ||
      asignaciones.some((item) => !item || !Number.isInteger(item.id_curso) || item.id_curso < 1 ||
        !validSubjectCode(item.codigo_materia)) ||
      new Set(asignaciones.map((item) => `${item.id_curso}/${item.codigo_materia}`)).size !== asignaciones.length)) {
    return fail(res, 400, "Las asignaciones deben indicar un curso y una materia sin repetir");
  }
  const unique = [...new Set(permisos)];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exists = await client.query("SELECT 1 FROM preceptor WHERE dni=$1 FOR UPDATE", [req.params.dni]);
    if (!exists.rows[0]) throw new Error("Preceptor no encontrado");
    await client.query("DELETE FROM preceptor_permiso WHERE dni_preceptor=$1", [req.params.dni]);
    for (const codigo of unique)
      await client.query("INSERT INTO preceptor_permiso (dni_preceptor, codigo) VALUES ($1,$2)", [req.params.dni, codigo]);
    if (asignaciones !== undefined) {
      const cycleId = await getCycleId(client, requestedCycleYear(req));
      if (!cycleId) throw requestError(400, "No hay un ciclo lectivo seleccionado");
      await client.query(
        "DELETE FROM preceptor_curso_materia WHERE dni_preceptor=$1 AND id_ciclo_lectivo=$2",
        [req.params.dni, cycleId],
      );
      await client.query(
        `INSERT INTO preceptor_curso_materia (dni_preceptor,id_ciclo_lectivo,id_curso,codigo_materia)
         SELECT $1,$2,id,codigo FROM unnest($3::integer[], $4::varchar[]) AS item(id,codigo)`,
        [req.params.dni, cycleId, asignaciones.map((item) => item.id_curso), asignaciones.map((item) => item.codigo_materia)],
      );
    }
    await client.query("COMMIT");
    res.json({ permisos: unique });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23503")
      return fail(res, 400, "Solo se pueden asignar materias inscritas en el curso del ciclo lectivo");
    fail(res, error.message === "Preceptor no encontrado" ? 404 : 400, error.message || "No se pudieron actualizar los permisos");
  } finally { client.release(); }
});

app.patch("/api/docentes/:dni/datos", auth, async (req, res) => {
  if (!(await hasPreceptorPermission(req.user, "docentes.editar_datos")))
    return fail(res, 403, "No tenés permiso para editar datos de docentes");
  if (!(await hasPreceptorTeacherScope(req.user, req.params.dni, requestedCycleYear(req))))
    return fail(res, 403, "El docente no pertenece a una asignación de preceptoría");
  const { nombre, apellido, email, telefono } = req.body || {};
  if (!String(nombre || "").trim() || !String(apellido || "").trim())
    return fail(res, 400, "El nombre y apellido son obligatorios");
  const { rows } = await pool.query(
    "UPDATE profesor SET nombre=$2, apellido=$3, email=$4, telefono=$5 WHERE dni=$1 RETURNING dni",
    [req.params.dni, String(nombre).trim(), String(apellido).trim(), String(email || "").trim() || null, String(telefono || "").trim() || null],
  );
  if (!rows[0]) return fail(res, 404, "Docente no encontrado");
  res.json({ ok: true });
});

app.patch("/api/docentes/:dni/estado", auth, async (req, res) => {
  if (!(await hasPreceptorPermission(req.user, "docentes.cambiar_estado")))
    return fail(res, 403, "No tenés permiso para cambiar el estado de docentes");
  if (!(await hasPreceptorTeacherScope(req.user, req.params.dni, requestedCycleYear(req))))
    return fail(res, 403, "El docente no pertenece a una asignación de preceptoría");
  const { estado } = req.body || {};
  if (!["Activo", "Baja"].includes(estado))
    return fail(res, 400, "Un preceptor solo puede establecer Activo o Baja");
  const { rows } = await pool.query("UPDATE profesor SET estado=$2 WHERE dni=$1 RETURNING dni", [req.params.dni, estado]);
  if (!rows[0]) return fail(res, 404, "Docente no encontrado");
  await pool.query("UPDATE usuario SET estado=$2 WHERE dni_profesor=$1", [req.params.dni, estado]);
  res.json({ ok: true });
});

app.patch("/api/alumnos/:dni/datos", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!(await hasPreceptorPermission(req.user, "alumnos.editar_datos")))
      return fail(res, 403, "No tenés permiso para editar datos de alumnos");
    const body = req.body || {};
    const { nombre, apellido, email } = body;
    if (!String(nombre || "").trim() || !String(apellido || "").trim())
      return fail(res, 400, "El nombre y apellido son obligatorios");
    const address = readStudentAddress(body);
    const details = readStudentDetails(body);
    await client.query("BEGIN");
    const { rows: [student] } = await client.query(
      "SELECT id_domicilio FROM alumno WHERE dni=$1 FOR UPDATE", [req.params.dni],
    );
    if (!student) throw requestError(404, "Alumno no encontrado");
    if (!(await hasPreceptorStudentScope(client, req.user, req.params.dni, requestedCycleYear(req))))
      throw requestError(403, "El alumno no pertenece a un curso asignado");
    await client.query(
      "UPDATE alumno SET nombre=$2, apellido=$3, email=$4 WHERE dni=$1",
      [req.params.dni, nombre.trim(), apellido.trim(), String(email || "").trim() || null],
    );
    await updateStudentAddress(client, req.params.dni, student.id_domicilio, address);
    await updateStudentDetails(client, req.params.dni, details);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.status) return fail(res, error.status, error.message);
    console.error(error);
    fail(res, 500, "No se pudieron guardar los datos del alumno");
  } finally {
    client.release();
  }
});

app.patch("/api/alumnos/:dni/estado", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!(await hasPreceptorPermission(req.user, "alumnos.cambiar_estado")))
      return fail(res, 403, "No tenés permiso para cambiar el estado de alumnos");
    const { estado } = req.body || {};
    if (!["Activo", "Egresado", "Baja", "Suspendido", "Transferido", "No corresponde"].includes(estado))
      return fail(res, 400, "El estado del alumno no es válido");
    await client.query("BEGIN");
    const locked = await client.query("SELECT 1 FROM alumno WHERE dni=$1 FOR UPDATE", [req.params.dni]);
    if (!locked.rowCount) throw requestError(404, "Alumno no encontrado");
    if (!(await hasPreceptorStudentScope(client, req.user, req.params.dni, requestedCycleYear(req))))
      throw requestError(403, "El alumno no pertenece a un curso asignado");
    await client.query("UPDATE alumno SET estado=$2 WHERE dni=$1", [req.params.dni, estado]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.status) return fail(res, error.status, error.message);
    console.error(error);
    fail(res, 500, "No se pudo cambiar el estado del alumno");
  } finally {
    client.release();
  }
});

app.get("/api/cursos", auth, async (req, res) => {
  try {
    const { rol: role, dni_preceptor: preceptor, dni_profesor: teacher } = req.user;
    if (role === "alumno") return res.json([]);
    const cicloLectivo = Number(req.query.ciclo_lectivo) || null;
    const { rows } = await pool.query(
      `
      SELECT c.*,
             COUNT(DISTINCT a.dni)::int AS cantidad_alumnos,
         cl.anio AS ciclo_lectivo,
             e.nombre AS especialidad, p.nombre AS plan_estudio,
         t.id_turno AS turno_id,
             t.jornada AS turno,
             COALESCE(
               JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('codigo', m.codigo, 'nombre', m.nombre))
                 FILTER (WHERE m.codigo IS NOT NULL),
               '[]'::jsonb
             ) AS materias
      FROM curso c
      JOIN plan_estudio p ON p.id_plan_estudio=c.id_plan_estudio
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
        AND ($2='admin' OR (
          $2='preceptor' AND EXISTS (
            SELECT 1 FROM preceptor_curso_materia scope
            WHERE scope.dni_preceptor=$3 AND scope.id_curso=cm.id_curso
              AND scope.id_ciclo_lectivo=cm.id_ciclo_lectivo AND scope.codigo_materia=cm.codigo_materia
          )
        ) OR (
          $2='profesor' AND EXISTS (
            SELECT 1 FROM profesor_curso_materia scope
            JOIN profesor titular ON titular.dni=scope.dni_profesor
            JOIN profesor docente ON docente.dni=$4
            WHERE scope.id_curso=cm.id_curso AND scope.id_ciclo_lectivo=cm.id_ciclo_lectivo
              AND scope.codigo_materia=cm.codigo_materia AND (
                (titular.dni=$4 AND titular.estado='Activo')
                OR (titular.dni_suplente=$4 AND titular.estado='Licencia' AND docente.estado='Suplente')
              )
          )
        ))
      LEFT JOIN materia m ON m.codigo=cm.codigo_materia
      GROUP BY c.id_curso, cl.anio, e.nombre, p.nombre, t.id_turno, t.jornada
      HAVING cl.anio=COALESCE($1::integer, (SELECT MAX(anio) FROM ciclo_lectivo))
        AND ($2='admin' OR COUNT(m.codigo)>0)
      ORDER BY c.anio, c.division
    `,
      [cicloLectivo, role, preceptor, teacher],
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener los cursos");
  }
});

async function listTeacherAssignments(dni, cycleId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT pcm.id_curso, pcm.codigo_materia
     FROM profesor_curso_materia pcm
     JOIN profesor titular ON titular.dni=pcm.dni_profesor
     JOIN profesor docente ON docente.dni=$1
     WHERE pcm.id_ciclo_lectivo=$2 AND (
       (titular.dni=$1 AND titular.estado='Activo')
       OR (titular.dni_suplente=$1 AND titular.estado='Licencia' AND docente.estado='Suplente')
     ) ORDER BY pcm.id_curso, pcm.codigo_materia`,
    [dni, cycleId],
  );
  return rows;
}

app.get("/api/docente-asignaciones", auth, roles("profesor"), async (req, res) => {
  if (!req.user.dni_profesor) return fail(res, 403, "El usuario no tiene un docente asignado");
  try {
    const cycleId = await getCycleId(pool, requestedCycleYear(req));
    res.json(await listTeacherAssignments(req.user.dni_profesor, cycleId));
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener las asignaciones del docente");
  }
});

async function saveCourse(req, res) {
  const editing = req.params.id !== undefined;
  const id = Number(req.params.id);
  const year = Number(req.body.anio);
  const division = typeof req.body.division === "string"
    ? req.body.division.trim().toUpperCase()
    : "";
  const planId = Number(req.body.id_plan_estudio);
  const shiftId = req.body.turno_id ? Number(req.body.turno_id) : null;
  if ((editing && (!Number.isInteger(id) || id < 1)) ||
      !/^[A-Z0-9]{1,10}$/.test(division) ||
      (shiftId !== null && (!Number.isInteger(shiftId) || shiftId < 1))) {
    return fail(res, 400, "Ingresá una división válida y revisá el curso y el turno");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cycleId = await getCycleId(client, requestedCycleYear(req));
    if (!cycleId) throw requestError(400, "No hay un ciclo lectivo seleccionado");
    const plan = await lockPlan(client, planId);
    if (!planAllowsYear(plan, year))
      throw requestError(400, "El plan no corresponde al año elegido");
    const specialty = plan.id_especialidad;
    const codes = req.body.materias;
    validateCourseSubjects(codes);
    await validatePlanSubjects(client, planId, year, codes);

    let course;
    if (editing) {
      const { rows: [current] } = await client.query(
        "SELECT * FROM curso WHERE id_curso=$1 AND id_ciclo_lectivo=$2 FOR UPDATE",
        [id, cycleId],
      );
      if (!current) throw requestError(404, "Curso no encontrado en el ciclo lectivo");
      if (current.anio !== year || current.id_especialidad !== specialty) {
        const enrollment = await client.query(
          "SELECT 1 FROM alumno_curso WHERE id_curso=$1 LIMIT 1",
          [id],
        );
        if (enrollment.rowCount)
          throw requestError(409, "El año y la especialidad de un curso con inscripciones no se pueden cambiar");
      }
      await client.query(
        `DELETE FROM curso_materia WHERE id_curso=$1 AND id_ciclo_lectivo=$2
          AND NOT (codigo_materia=ANY($3::varchar[]))`,
        [id, cycleId, codes],
      );
      const updated = await client.query(
        `UPDATE curso SET anio=$2, division=$3, id_especialidad=$4, id_plan_estudio=$5
         WHERE id_curso=$1 RETURNING *`,
        [id, year, division, specialty, planId],
      );
      course = updated.rows[0];
    } else {
      const created = await client.query(
        `INSERT INTO curso (anio, division, id_ciclo_lectivo, id_especialidad, id_plan_estudio)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [year, division, cycleId, specialty, planId],
      );
      course = created.rows[0];
    }

    if (shiftId === null) {
      await client.query("DELETE FROM curso_turno WHERE id_curso=$1", [course.id_curso]);
    } else {
      await client.query(
        `INSERT INTO curso_turno (id_curso, id_turno) VALUES ($1,$2)
         ON CONFLICT (id_curso) DO UPDATE SET id_turno=EXCLUDED.id_turno`,
        [course.id_curso, shiftId],
      );
    }
    await addCourseSubjects(client, course, codes);
    const specialtyResult = await client.query(
      "SELECT nombre FROM especialidad WHERE id_especialidad=$1", [specialty],
    );
    await client.query("COMMIT");
    res.status(editing ? 200 : 201).json({
      ...course,
      especialidad: specialtyResult.rows[0]?.nombre || null,
      plan_estudio: plan.nombre,
      turno_id: shiftId,
      materias: codes,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.status) return fail(res, error.status, error.message);
    if (error.code === "23505")
      return fail(res, 409, "Ya existe esa división para el año y especialidad en el ciclo lectivo");
    if (error.code === "23503") {
      if (error.table === "curso_turno") return fail(res, 400, "El turno no existe");
      return fail(res, 409, "No se puede quitar una materia con calificaciones o personal asignado");
    }
    console.error(error);
    fail(res, 500, "No se pudo guardar el curso");
  } finally {
    client.release();
  }
}

app.post("/api/cursos", auth, roles("admin"), saveCourse);
app.put("/api/cursos/:id", auth, roles("admin"), saveCourse);

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
        "No se puede eliminar un curso con alumnos, calificaciones o personal asignado",
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

app.get("/api/planes-estudio", auth, roles("admin"), async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id_plan_estudio, p.nombre, p.ciclo, p.id_especialidad, e.nombre AS especialidad,
             COALESCE(json_agg(json_build_object(
               'anio', pm.anio, 'codigo', m.codigo, 'nombre', m.nombre
             ) ORDER BY pm.anio, m.nombre) FILTER (WHERE pm.codigo_materia IS NOT NULL), '[]'::json) AS materias
      FROM plan_estudio p
      LEFT JOIN especialidad e ON e.id_especialidad=p.id_especialidad
      LEFT JOIN plan_estudio_materia pm ON pm.id_plan_estudio=p.id_plan_estudio
      LEFT JOIN materia m ON m.codigo=pm.codigo_materia
      GROUP BY p.id_plan_estudio, e.nombre
      ORDER BY p.ciclo, p.nombre
    `);
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener los planes de estudio");
  }
});

app.get("/api/especialidades", auth, roles("admin"), async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM especialidad ORDER BY nombre");
    res.json(rows);
  } catch (error) {
    console.error(error);
    fail(res, 500, "No se pudieron obtener las especialidades");
  }
});

async function saveStudyPlan(req, res) {
  const editing = req.params.id !== undefined;
  const id = Number(req.params.id);
  const name = typeof req.body.nombre === "string" ? req.body.nombre.trim() : "";
  const cycle = req.body.ciclo;
  const specialty = cycle === "Superior" ? Number(req.body.id_especialidad) : null;
  const entries = req.body.materias;
  if ((editing && (!Number.isInteger(id) || id < 1)) || !name || name.length > 100 ||
      !["Básico", "Superior"].includes(cycle) ||
      (cycle === "Superior" && (!Number.isInteger(specialty) || specialty < 1)) ||
      !Array.isArray(entries) ||
      entries.some((entry) => !entry || !planAllowsYear({ ciclo: cycle }, entry.anio) || !validSubjectCode(entry.codigo))) {
    return fail(res, 400, "Revisá el nombre, la especialidad y los años de las materias del plan");
  }
  if (new Set(entries.map(({ anio, codigo }) => `${anio}/${codigo}`)).size !== entries.length)
    return fail(res, 400, "No se puede repetir una materia en el mismo año del plan");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let savedId;
    if (editing) {
      const { rows: [current] } = await client.query(
        "SELECT * FROM plan_estudio WHERE id_plan_estudio=$1 FOR UPDATE", [id],
      );
      if (!current) throw requestError(404, "Plan de estudio no encontrado");
      if (current.ciclo !== cycle || current.id_especialidad !== specialty) {
        const courses = await client.query("SELECT 1 FROM curso WHERE id_plan_estudio=$1 LIMIT 1", [id]);
        if (courses.rowCount)
          throw requestError(409, "Creá otro plan para cambiar el ciclo o la especialidad de un plan en uso");
      }
      await client.query(
        "UPDATE plan_estudio SET nombre=$2, ciclo=$3, id_especialidad=$4 WHERE id_plan_estudio=$1",
        [id, name, cycle, specialty],
      );
      savedId = id;
    } else {
      const { rows } = await client.query(
        "INSERT INTO plan_estudio (nombre,ciclo,id_especialidad) VALUES ($1,$2,$3) RETURNING id_plan_estudio",
        [name, cycle, specialty],
      );
      savedId = rows[0].id_plan_estudio;
    }
    const years = entries.map((entry) => entry.anio);
    const codes = entries.map((entry) => entry.codigo);
    const catalog = await client.query("SELECT codigo FROM materia WHERE codigo=ANY($1::varchar[])", [codes]);
    if (catalog.rowCount !== new Set(codes).size)
      throw requestError(400, "Una o más materias del plan no existen");
    if (editing) {
      await client.query(
        `DELETE FROM plan_estudio_materia pm WHERE id_plan_estudio=$1 AND NOT EXISTS (
           SELECT 1 FROM unnest($2::integer[], $3::varchar[]) AS item(anio,codigo)
           WHERE item.anio=pm.anio AND item.codigo=pm.codigo_materia
         )`,
        [savedId, years, codes],
      );
    }
    await client.query(
      `INSERT INTO plan_estudio_materia (id_plan_estudio, anio, codigo_materia)
       SELECT $1, anio, codigo FROM unnest($2::integer[], $3::varchar[]) AS item(anio,codigo)
       ON CONFLICT DO NOTHING`,
      [savedId, years, codes],
    );
    await client.query("COMMIT");
    res.status(editing ? 200 : 201).json({ id_plan_estudio: savedId });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.status) return fail(res, error.status, error.message);
    if (error.code === "23505") return fail(res, 409, "Ya existe un plan con ese nombre");
    if (error.code === "23503") {
      if (error.table === "plan_estudio") return fail(res, 400, "La especialidad no existe");
      return fail(res, 409, "La materia está en uso. Creá una versión del plan para cambiar la grilla");
    }
    console.error(error);
    fail(res, 500, "No se pudo guardar el plan de estudio");
  } finally {
    client.release();
  }
}

app.post("/api/planes-estudio", auth, roles("admin"), saveStudyPlan);
app.put("/api/planes-estudio/:id", auth, roles("admin"), saveStudyPlan);
app.delete("/api/planes-estudio/:id", auth, roles("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return fail(res, 400, "Plan de estudio no válido");
  try {
    const result = await pool.query("DELETE FROM plan_estudio WHERE id_plan_estudio=$1", [id]);
    if (!result.rowCount) return fail(res, 404, "Plan de estudio no encontrado");
    res.json({ ok: true });
  } catch (error) {
    if (error.code === "23503") return fail(res, 409, "El plan está asignado a un curso");
    console.error(error);
    fail(res, 500, "No se pudo eliminar el plan de estudio");
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
          INSERT INTO curso (anio, division, id_ciclo_lectivo, id_especialidad, id_plan_estudio)
          VALUES ($1,$2,$3,$4,$5)
          RETURNING id_curso
        `,
          [curso.anio, curso.division, targetCycleId, curso.id_especialidad, curso.id_plan_estudio],
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
          INSERT INTO curso_materia (id_curso, codigo_materia, id_ciclo_lectivo, id_plan_estudio, anio)
          SELECT $1, codigo_materia, $3, id_plan_estudio, anio
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
      for (const [sourceId, newId] of courseIds) {
        await client.query(
          `INSERT INTO preceptor_curso_materia (dni_preceptor,id_curso,codigo_materia,id_ciclo_lectivo)
           SELECT dni_preceptor,$1,codigo_materia,$2 FROM preceptor_curso_materia
           WHERE id_curso=$3 AND id_ciclo_lectivo=$4`,
          [newId, targetCycleId, sourceId, sourceCycleId],
        );
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
        (EXISTS(SELECT 1 FROM profesor_curso_materia WHERE id_ciclo_lectivo=$1)
          OR EXISTS(SELECT 1 FROM preceptor_curso_materia WHERE id_ciclo_lectivo=$1)) AS tiene_asignaciones,
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
    if (!cycleId || req.user.rol === "alumno") return res.json([]);
    if (req.user.rol === "preceptor" || req.user.rol === "profesor") {
      const assignments = req.user.rol === "preceptor"
        ? await listPreceptorAssignments(req.user.dni_preceptor, requestedCycleYear(req))
        : await listTeacherAssignments(req.user.dni_profesor, cycleId);
      const { rows } = await pool.query(
        "SELECT codigo, nombre, descripcion FROM materia WHERE codigo=ANY($1::varchar[]) ORDER BY nombre",
        [assignments.map((item) => item.codigo_materia)],
      );
      return res.json(rows);
    }
    const { rows } = await pool.query(
      `
      SELECT m.codigo, m.nombre, m.descripcion,
             COALESCE((
               SELECT json_agg(json_build_object('id_plan_estudio', p.id_plan_estudio, 'plan', p.nombre, 'anio', pm.anio)
                               ORDER BY p.nombre, pm.anio)
               FROM plan_estudio_materia pm JOIN plan_estudio p USING (id_plan_estudio)
               WHERE pm.codigo_materia=m.codigo
             ), '[]'::json) AS planes,
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
      SELECT m.codigo, m.nombre, m.descripcion,
             cm.codigo_materia IS NOT NULL AS asignada
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
  const descripcion =
    typeof req.body.descripcion === "string" ? req.body.descripcion.trim() : "";

  if (!/^[A-Z0-9_-]{2,20}$/.test(codigo)) {
    return fail(
      res,
      400,
      "El código debe tener entre 2 y 20 letras, números, guiones o guiones bajos",
    );
  }
  if (!nombre || nombre.length > 100)
    return fail(res, 400, "El nombre de la materia no es válido");
  if (descripcion.length > 1000)
    return fail(res, 400, "La descripción no puede superar los 1000 caracteres");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cycleId = await getCycleId(client, requestedCycleYear(req));
    if (!cycleId) {
      await client.query("ROLLBACK");
      return fail(res, 400, "No hay un ciclo lectivo seleccionado");
    }
    const plan = await lockPlan(client, Number(req.body.id_plan_estudio));
    const year = Number(req.body.anio);
    if (!planAllowsYear(plan, year))
      throw requestError(400, "El año no corresponde al plan seleccionado");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended(LOWER(BTRIM($1)), 0))",
      [nombre],
    );
    const { rows: existingName } = await client.query(
      `
      SELECT codigo, nombre, descripcion
      FROM materia
      WHERE LOWER(BTRIM(nombre))=LOWER(BTRIM($1))
      ORDER BY codigo
      LIMIT 1
      FOR UPDATE
    `,
      [nombre],
    );
    let subject = existingName[0];
    const reused = Boolean(subject);
    if (!subject) {
      const { rows } = await client.query(
        "INSERT INTO materia (codigo, nombre, descripcion) VALUES ($1,$2,$3) RETURNING *",
        [codigo, nombre, descripcion],
      );
      subject = rows[0];
    }
    await client.query(
      `INSERT INTO plan_estudio_materia (id_plan_estudio, anio, codigo_materia)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [plan.id_plan_estudio, year, subject.codigo],
    );
    await client.query(
      `INSERT INTO ciclo_materia (id_ciclo_lectivo, codigo_materia)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [cycleId, subject.codigo],
    );
    await client.query("COMMIT");
    res.status(reused ? 200 : 201).json({ ...subject, profesores: [], reutilizada: reused });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.status) return fail(res, error.status, error.message);
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
  const descripcion =
    typeof req.body.descripcion === "string" ? req.body.descripcion.trim() : "";

  if (!/^[A-Z0-9_-]{2,20}$/.test(codigo))
    return fail(res, 400, "El código de la materia no es válido");
  if (!nombre || nombre.length > 100)
    return fail(res, 400, "El nombre de la materia no es válido");
  if (descripcion.length > 1000)
    return fail(res, 400, "La descripción no puede superar los 1000 caracteres");

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
      SET nombre=$2, descripcion=$3
      WHERE codigo=$1
      RETURNING codigo, nombre, descripcion
    `,
      [codigo, nombre, descripcion],
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
    const curricularAssignments = await client.query(
      "SELECT 1 FROM plan_estudio_materia WHERE codigo_materia=$1 LIMIT 1", [codigo],
    );
    const eliminada = remainingAssignments.rowCount === 0 && curricularAssignments.rowCount === 0;
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

app.get("/api/notas", auth, roles("admin", "profesor", "preceptor"), async (req, res) => {
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
      const { rows: teacherRows } = await pool.query(
        "SELECT estado FROM profesor WHERE dni=$1",
        [req.user.dni_profesor],
      );
      if (!teacherRows[0] || teacherRows[0].estado === "Licencia")
        return fail(res, 403, "El docente está en licencia y no puede cargar notas");
      const teacherParameter = params.length + 1;
      params.push(req.user.dni_profesor, teacherRows[0].estado);
      where += ` AND EXISTS (
        SELECT 1
        FROM profesor_curso_materia pcm
        JOIN profesor titular ON titular.dni=pcm.dni_profesor
        WHERE (
            (
              titular.dni=$${teacherParameter}
              AND titular.estado='Activo'
              AND $${teacherParameter + 1}::varchar='Activo'
            )
            OR (
              titular.dni_suplente=$${teacherParameter}
              AND titular.estado='Licencia'
              AND $${teacherParameter + 1}::varchar='Suplente'
            )
          )
          AND pcm.id_curso=ac.id_curso
          AND pcm.id_ciclo_lectivo=ac.id_ciclo_lectivo
          AND pcm.codigo_materia=n.codigo_materia
      )`;
    }

    if (req.user.rol === "preceptor") {
      params.push(req.user.dni_preceptor);
      where += ` AND EXISTS (
        SELECT 1 FROM preceptor_curso_materia scope
        WHERE scope.dni_preceptor=$${params.length} AND scope.id_curso=ac.id_curso
          AND scope.id_ciclo_lectivo=ac.id_ciclo_lectivo AND scope.codigo_materia=n.codigo_materia
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
      id_curso: courseId,
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
    if (!Number.isFinite(Number(calificacion)) || Number(calificacion) < 1 || Number(calificacion) > 10) {
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
        AND ($3::integer IS NULL OR ac.id_curso=$3)
        AND cl.anio=COALESCE($2::integer, (SELECT MAX(anio) FROM ciclo_lectivo))
      LIMIT 1
    `,
        [dni_alumno, requestedCycleYear(req) || Number(ciclo_lectivo) || null, courseId ?? null],
      );
      if (!enrollment.rows[0]) {
        return fail(
          res,
          400,
          "El alumno no tiene curso asignado en ese ciclo lectivo",
        );
      }
      const { id_curso, id_ciclo_lectivo } = enrollment.rows[0];
      if (
        !(await canManageGrade(
          req,
          { id_curso, id_ciclo_lectivo },
          codigo_materia,
        ))
      ) {
        return fail(
          res,
          403,
          "No tenés permiso para calificar esta materia en el curso",
        );
      }
      const { rows } = await pool.query(
        `
      INSERT INTO nota
        (dni_alumno,id_curso,id_ciclo_lectivo,codigo_materia,tipo_evaluacion,calificacion,observacion,fecha,dni_profesor)
      VALUES ($1,$8,$9,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7)
      ON CONFLICT (dni_alumno,id_curso,codigo_materia,tipo_evaluacion,id_ciclo_lectivo)
      DO UPDATE SET
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
    const { dni_alumno, id_curso: courseId, codigo_materia, tipo_evaluacion, ciclo_lectivo } =
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
        AND ($3::integer IS NULL OR ac.id_curso=$3)
        AND cl.anio=COALESCE($2::integer, (SELECT MAX(anio) FROM ciclo_lectivo))
      LIMIT 1
    `,
        [dni_alumno, requestedCycleYear(req) || Number(ciclo_lectivo) || null, courseId ?? null],
      );
      if (!enrollment.rows[0]) {
        return fail(
          res,
          400,
          "El alumno no tiene curso asignado en ese ciclo lectivo",
        );
      }
      const { id_curso, id_ciclo_lectivo } = enrollment.rows[0];

      if (
        !(await canManageGrade(
          req,
          { id_curso, id_ciclo_lectivo },
          codigo_materia,
        ))
      ) {
        return fail(
          res,
          403,
          "No tenés permiso para calificar esta materia en el curso",
        );
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

async function canManageGrade(req, enrollment, codigoMateria, write = true) {
  if (req.user.rol === "admin") return true;
  if (req.user.rol === "preceptor") {
    if (write && !(await hasPreceptorPermission(req.user, "notas.editar"))) return false;
    const result = await pool.query(
      `SELECT 1 FROM preceptor_curso_materia
       WHERE dni_preceptor=$1 AND id_curso=$2 AND id_ciclo_lectivo=$3 AND codigo_materia=$4`,
      [req.user.dni_preceptor, enrollment.id_curso, enrollment.id_ciclo_lectivo, codigoMateria],
    );
    return result.rowCount > 0;
  }
  if (!req.user.dni_profesor) return false;
  const { rows } = await pool.query(
    `
    SELECT 1
    FROM profesor docente
    WHERE docente.dni=$1
      AND EXISTS (
        SELECT 1
        FROM profesor_curso_materia pcm
        JOIN profesor titular ON titular.dni=pcm.dni_profesor
        WHERE (
            (
              docente.estado='Activo'
              AND titular.dni=docente.dni
              AND titular.estado='Activo'
            )
            OR (
              docente.estado='Suplente'
              AND titular.dni_suplente=docente.dni
              AND titular.estado='Licencia'
            )
          )
          AND pcm.id_curso=$2
          AND pcm.id_ciclo_lectivo=$3
          AND pcm.codigo_materia=$4
      )
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
      if (!(await canManageGrade(req, enrollment, materia, false))) {
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
        !(await canManageGrade(
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
        !(await canManageGrade(
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
      if (!(await canManageGrade(req, enrollment, codigo_materia))) {
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
    if (req.user.rol !== "admin") return res.json([]);
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
