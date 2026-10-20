-- Base de datos: gestion_notas
-- PostgreSQL 18+
-- Modelo simplificado y funcional para el proyecto escolar.

CREATE TABLE IF NOT EXISTS turno (
    id_turno SERIAL PRIMARY KEY,
    jornada VARCHAR(30) NOT NULL,
    hora_inicio TIME,
    hora_fin TIME
);

CREATE TABLE IF NOT EXISTS domicilio (
    id_domicilio SERIAL PRIMARY KEY,
    calle VARCHAR(100) NOT NULL,
    numero_calle VARCHAR(10),
    departamento VARCHAR(50),
    localidad VARCHAR(80) NOT NULL
);

CREATE TABLE IF NOT EXISTS curso (
    id_curso SERIAL PRIMARY KEY,
    anio INTEGER NOT NULL CHECK (anio BETWEEN 1 AND 7),
    division VARCHAR(10) NOT NULL,
    ciclo_lectivo INTEGER NOT NULL,
    especialidad VARCHAR(100),
    id_turno INTEGER REFERENCES turno(id_turno),
    UNIQUE (anio, division, ciclo_lectivo)
);

CREATE TABLE IF NOT EXISTS materia (
    codigo VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    carga_horaria_semanal INTEGER
);

CREATE TABLE IF NOT EXISTS profesor (
    dni VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    apellido VARCHAR(80) NOT NULL,
    email VARCHAR(150),
    telefono VARCHAR(30),
    id_domicilio INTEGER REFERENCES domicilio(id_domicilio)
);

CREATE TABLE IF NOT EXISTS alumno (
    dni VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    apellido VARCHAR(80) NOT NULL,
    fecha_nacimiento DATE,
    genero VARCHAR(30),
    nacionalidad VARCHAR(60),
    email VARCHAR(150),
    estado VARCHAR(30) NOT NULL DEFAULT 'Activo'
        CHECK (estado IN ('Activo','Egresado','Baja','Suspendido','Transferido','No corresponde')),
    id_domicilio INTEGER REFERENCES domicilio(id_domicilio),
    id_curso INTEGER REFERENCES curso(id_curso)
);

CREATE TABLE IF NOT EXISTS adulto_responsable (
    dni VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    apellido VARCHAR(80) NOT NULL,
    telefono VARCHAR(30),
    email VARCHAR(150)
);

CREATE TABLE IF NOT EXISTS responsables_alumnos (
    dni_responsable VARCHAR(20) REFERENCES adulto_responsable(dni) ON DELETE CASCADE,
    dni_alumno VARCHAR(20) REFERENCES alumno(dni) ON DELETE CASCADE,
    PRIMARY KEY (dni_responsable, dni_alumno)
);

CREATE TABLE IF NOT EXISTS rol (
    id_rol SERIAL PRIMARY KEY,
    nombre VARCHAR(40) UNIQUE NOT NULL,
    descripcion TEXT
);

CREATE TABLE IF NOT EXISTS usuario (
    id_usuario SERIAL PRIMARY KEY,
    nombre_usuario VARCHAR(80) UNIQUE NOT NULL,
    contrasenia VARCHAR(255) NOT NULL,
    ultimo_acceso TIMESTAMP,
    estado VARCHAR(20) NOT NULL DEFAULT 'Activo',
    dni_alumno VARCHAR(20) UNIQUE REFERENCES alumno(dni),
    dni_profesor VARCHAR(20) UNIQUE REFERENCES profesor(dni),
    id_rol INTEGER REFERENCES rol(id_rol),
    CHECK (
        (dni_alumno IS NOT NULL AND dni_profesor IS NULL)
        OR
        (dni_alumno IS NULL AND dni_profesor IS NOT NULL)
        OR
        (dni_alumno IS NULL AND dni_profesor IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS profesor_rol (
    dni_profesor VARCHAR(20) REFERENCES profesor(dni) ON DELETE CASCADE,
    id_rol INTEGER REFERENCES rol(id_rol) ON DELETE CASCADE,
    PRIMARY KEY (dni_profesor, id_rol)
);

CREATE TABLE IF NOT EXISTS profesor_curso_materia (
    dni_profesor VARCHAR(20) REFERENCES profesor(dni) ON DELETE CASCADE,
    id_curso INTEGER REFERENCES curso(id_curso) ON DELETE CASCADE,
    codigo_materia VARCHAR(20) REFERENCES materia(codigo) ON DELETE CASCADE,
    PRIMARY KEY (dni_profesor, id_curso, codigo_materia)
);

CREATE TABLE IF NOT EXISTS nota (
    id_nota SERIAL PRIMARY KEY,
    calificacion NUMERIC(4,2) CHECK (calificacion BETWEEN 1 AND 10),
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo_evaluacion VARCHAR(30) NOT NULL,
    observacion TEXT,
    dni_alumno VARCHAR(20) NOT NULL REFERENCES alumno(dni) ON DELETE CASCADE,
    codigo_materia VARCHAR(20) NOT NULL REFERENCES materia(codigo),
    dni_profesor VARCHAR(20) REFERENCES profesor(dni),
    UNIQUE (dni_alumno, codigo_materia, tipo_evaluacion)
);

CREATE INDEX IF NOT EXISTS idx_alumno_curso ON alumno(id_curso);
CREATE INDEX IF NOT EXISTS idx_nota_alumno ON nota(dni_alumno);
CREATE INDEX IF NOT EXISTS idx_nota_materia ON nota(codigo_materia);

-- Datos mínimos para poder probar la página.
INSERT INTO turno (jornada, hora_inicio, hora_fin)
SELECT 'Mañana', '07:45', '12:30'
WHERE NOT EXISTS (SELECT 1 FROM turno WHERE jornada='Mañana');

INSERT INTO curso (anio, division, ciclo_lectivo, especialidad, id_turno)
SELECT 6, '1', 2026, 'Computación',
       (SELECT id_turno FROM turno WHERE jornada='Mañana' LIMIT 1)
WHERE NOT EXISTS (
    SELECT 1 FROM curso WHERE anio=6 AND division='1' AND ciclo_lectivo=2026
);

INSERT INTO materia (codigo, nombre, descripcion, carga_horaria_semanal)
VALUES ('PPP', 'Prácticas Profesionalizantes', 'Materia de prácticas profesionalizantes', 6)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO profesor (dni, nombre, apellido, email)
VALUES ('31928371', 'Juan', 'Moya', 'juan.moya@escuela.edu.ar')
ON CONFLICT (dni) DO NOTHING;

INSERT INTO profesor (dni, nombre, apellido, email)
VALUES ('32651658', 'Aaron', 'Serrano', 'aaron.serrano@escuela.edu.ar')
ON CONFLICT (dni) DO NOTHING;

INSERT INTO alumno (dni, nombre, apellido, email, estado, id_curso)
VALUES (
    '96103383', 'Luis', 'Rodriguez', 'luis.rodriguez@escuela.edu.ar', 'Activo',
    (SELECT id_curso FROM curso WHERE anio=6 AND division='1' AND ciclo_lectivo=2026 LIMIT 1)
)
ON CONFLICT (dni) DO NOTHING;

INSERT INTO profesor_curso_materia (dni_profesor, id_curso, codigo_materia)
SELECT '31928371', id_curso, 'PPP'
FROM curso WHERE anio=6 AND division='1' AND ciclo_lectivo=2026
ON CONFLICT DO NOTHING;

INSERT INTO profesor_curso_materia (dni_profesor, id_curso, codigo_materia)
SELECT '32651658', id_curso, 'PPP'
FROM curso WHERE anio=6 AND division='1' AND ciclo_lectivo=2026
ON CONFLICT DO NOTHING;

INSERT INTO nota (calificacion, tipo_evaluacion, dni_alumno, codigo_materia, dni_profesor, observacion)
VALUES (9, 'BIMESTRE_1', '96103383', 'PPP', '31928371', 'Nota de prueba')
ON CONFLICT (dni_alumno, codigo_materia, tipo_evaluacion) DO NOTHING;

INSERT INTO nota (calificacion, tipo_evaluacion, dni_alumno, codigo_materia, dni_profesor)
VALUES (9, 'BIMESTRE_2', '96103383', 'PPP', '31928371')
ON CONFLICT (dni_alumno, codigo_materia, tipo_evaluacion) DO NOTHING;
