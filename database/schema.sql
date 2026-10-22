-- Base de datos: gestion_notas
-- PostgreSQL 18+
-- Modelo simplificado y funcional para el proyecto escolar.

CREATE TABLE IF NOT EXISTS turno (
    id_turno SERIAL PRIMARY KEY,
    jornada VARCHAR(30) NOT NULL,
    hora_inicio TIME,
    hora_fin TIME,
    entrada_prehora TIME,
    salida_poshora TIME
);

CREATE TABLE IF NOT EXISTS domicilio (
    id_domicilio SERIAL PRIMARY KEY,
    calle VARCHAR(100) NOT NULL,
    numero_calle VARCHAR(10),
    departamento VARCHAR(50),
    localidad VARCHAR(80) NOT NULL
);

CREATE TABLE IF NOT EXISTS ciclo_lectivo (
    id_ciclo_lectivo SERIAL PRIMARY KEY,
    anio INTEGER NOT NULL UNIQUE CHECK (anio BETWEEN 1900 AND 2200)
);

INSERT INTO ciclo_lectivo (anio)
VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER)
ON CONFLICT (anio) DO NOTHING;

ALTER TABLE turno
    ADD COLUMN IF NOT EXISTS id_ciclo_lectivo INTEGER REFERENCES ciclo_lectivo(id_ciclo_lectivo) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS especialidad (
    id_especialidad SERIAL PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS curso (
    id_curso SERIAL PRIMARY KEY,
    anio INTEGER NOT NULL CHECK (anio BETWEEN 1 AND 6),
    division VARCHAR(10) NOT NULL,
    id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
    id_especialidad INTEGER NOT NULL REFERENCES especialidad(id_especialidad),
    UNIQUE (id_curso, id_ciclo_lectivo)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_curso_anio_especialidad_ciclo
    ON curso(anio, id_especialidad, id_ciclo_lectivo);

CREATE TABLE IF NOT EXISTS curso_turno (
    id_curso INTEGER PRIMARY KEY REFERENCES curso(id_curso) ON DELETE CASCADE,
    id_turno INTEGER REFERENCES turno(id_turno) ON DELETE CASCADE
);

DO $$
DECLARE
    ciclo RECORD;
    turno_actual RECORD;
    turno_copiado INTEGER;
BEGIN
    FOR ciclo IN
        SELECT id_ciclo_lectivo
        FROM ciclo_lectivo
        WHERE id_ciclo_lectivo <> (
            SELECT id_ciclo_lectivo
            FROM ciclo_lectivo
            ORDER BY anio DESC
            LIMIT 1
        )
    LOOP
        FOR turno_actual IN
            SELECT id_turno, jornada, hora_inicio, hora_fin, entrada_prehora, salida_poshora
            FROM turno
            WHERE id_ciclo_lectivo IS NULL
        LOOP
            INSERT INTO turno (jornada, hora_inicio, hora_fin, entrada_prehora, salida_poshora, id_ciclo_lectivo)
            VALUES (
                turno_actual.jornada, turno_actual.hora_inicio, turno_actual.hora_fin,
                turno_actual.entrada_prehora, turno_actual.salida_poshora, ciclo.id_ciclo_lectivo
            )
            RETURNING id_turno INTO turno_copiado;

            UPDATE curso_turno ct
            SET id_turno=turno_copiado
            FROM curso c
            WHERE ct.id_curso=c.id_curso
              AND ct.id_turno=turno_actual.id_turno
              AND c.id_ciclo_lectivo=ciclo.id_ciclo_lectivo;
        END LOOP;
    END LOOP;

    UPDATE turno
    SET id_ciclo_lectivo=(
        SELECT id_ciclo_lectivo
        FROM ciclo_lectivo
        ORDER BY anio DESC
        LIMIT 1
    )
    WHERE id_ciclo_lectivo IS NULL
      AND EXISTS (SELECT 1 FROM ciclo_lectivo);
END $$;

CREATE TABLE IF NOT EXISTS materia (
    codigo VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS ciclo_materia (
    id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo) ON DELETE CASCADE,
    codigo_materia VARCHAR(20) NOT NULL REFERENCES materia(codigo) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    PRIMARY KEY (id_ciclo_lectivo, codigo_materia)
);

CREATE TABLE IF NOT EXISTS app_schema_migration (
    nombre VARCHAR(100) PRIMARY KEY,
    ejecutada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS curso_materia (
    id_curso INTEGER NOT NULL,
    codigo_materia VARCHAR(20) NOT NULL REFERENCES materia(codigo),
    id_ciclo_lectivo INTEGER NOT NULL,
    PRIMARY KEY (id_curso, codigo_materia, id_ciclo_lectivo),
    FOREIGN KEY (id_curso, id_ciclo_lectivo)
        REFERENCES curso(id_curso, id_ciclo_lectivo) ON DELETE CASCADE
);

ALTER TABLE materia DROP COLUMN IF EXISTS carga_horaria_semanal;
ALTER TABLE materia DROP COLUMN IF EXISTS descripcion;

CREATE TABLE IF NOT EXISTS profesor (
    dni VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    apellido VARCHAR(80) NOT NULL,
    email VARCHAR(150),
    telefono VARCHAR(30),
    estado VARCHAR(20) NOT NULL DEFAULT 'Activo'
        CHECK (estado IN ('Activo','Licencia','Suplente','Baja')),
    id_domicilio INTEGER REFERENCES domicilio(id_domicilio)
);

CREATE TABLE IF NOT EXISTS preceptor (
    dni VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    apellido VARCHAR(80) NOT NULL,
    email VARCHAR(150),
    telefono VARCHAR(30)
);

ALTER TABLE preceptor ADD COLUMN IF NOT EXISTS email VARCHAR(150);

CREATE TABLE IF NOT EXISTS administrador (
    dni VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    apellido VARCHAR(80) NOT NULL,
    email VARCHAR(150),
    telefono VARCHAR(30),
    cargo VARCHAR(30) CHECK (cargo IN ('Regente', 'Subregente') OR cargo IS NULL)
);

ALTER TABLE administrador ADD COLUMN IF NOT EXISTS email VARCHAR(150);

ALTER TABLE profesor ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'Activo';
ALTER TABLE profesor DROP CONSTRAINT IF EXISTS profesor_estado_check;
ALTER TABLE profesor ADD CONSTRAINT profesor_estado_check
    CHECK (estado IN ('Activo','Licencia','Suplente','Baja'));

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
    id_domicilio INTEGER REFERENCES domicilio(id_domicilio)
);

CREATE TABLE IF NOT EXISTS alumno_curso (
    dni_alumno VARCHAR(20) NOT NULL REFERENCES alumno(dni) ON DELETE CASCADE,
    id_curso INTEGER NOT NULL REFERENCES curso(id_curso),
    id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
    fecha_inscripcion DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_baja DATE,
    PRIMARY KEY (dni_alumno, id_curso, id_ciclo_lectivo),
    FOREIGN KEY (id_curso, id_ciclo_lectivo)
        REFERENCES curso(id_curso, id_ciclo_lectivo),
    CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_inscripcion)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alumno_curso_vigente
    ON alumno_curso(dni_alumno, id_ciclo_lectivo)
    WHERE fecha_baja IS NULL;

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
    dni_preceptor VARCHAR(20) UNIQUE REFERENCES preceptor(dni),
    dni_administrador VARCHAR(20) UNIQUE REFERENCES administrador(dni),
    id_rol INTEGER REFERENCES rol(id_rol),
    CHECK (
        num_nonnulls(dni_alumno, dni_profesor, dni_preceptor, dni_administrador) <= 1
    )
);

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS dni_preceptor VARCHAR(20) UNIQUE REFERENCES preceptor(dni);
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS dni_administrador VARCHAR(20) UNIQUE REFERENCES administrador(dni);
ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_check;
ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_persona_check;
ALTER TABLE usuario ADD CONSTRAINT usuario_persona_check
    CHECK (num_nonnulls(dni_alumno, dni_profesor, dni_preceptor, dni_administrador) <= 1);

CREATE TABLE IF NOT EXISTS profesor_rol (
    dni_profesor VARCHAR(20) REFERENCES profesor(dni) ON DELETE CASCADE,
    id_rol INTEGER REFERENCES rol(id_rol) ON DELETE CASCADE,
    PRIMARY KEY (dni_profesor, id_rol)
);

CREATE TABLE IF NOT EXISTS profesor_curso_materia (
    dni_profesor VARCHAR(20) REFERENCES profesor(dni) ON DELETE CASCADE,
    id_curso INTEGER NOT NULL,
    codigo_materia VARCHAR(20) REFERENCES materia(codigo) ON DELETE CASCADE,
    id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
    PRIMARY KEY (dni_profesor, id_curso, codigo_materia, id_ciclo_lectivo),
    FOREIGN KEY (id_curso, id_ciclo_lectivo)
        REFERENCES curso(id_curso, id_ciclo_lectivo) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profesor_materia (
    dni_profesor VARCHAR(20) NOT NULL REFERENCES profesor(dni) ON DELETE CASCADE,
    codigo_materia VARCHAR(20) NOT NULL REFERENCES materia(codigo) ON DELETE CASCADE,
    id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
    PRIMARY KEY (dni_profesor, codigo_materia, id_ciclo_lectivo)
);

INSERT INTO profesor_materia (dni_profesor, codigo_materia, id_ciclo_lectivo)
SELECT DISTINCT dni_profesor, codigo_materia, id_ciclo_lectivo
FROM profesor_curso_materia
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS nota (
    id_nota SERIAL PRIMARY KEY,
    calificacion NUMERIC(4,2) CHECK (calificacion BETWEEN 1 AND 10),
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    tipo_evaluacion VARCHAR(30) NOT NULL,
    observacion TEXT,
    dni_alumno VARCHAR(20) NOT NULL REFERENCES alumno(dni) ON DELETE CASCADE,
    id_curso INTEGER NOT NULL,
    id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
    codigo_materia VARCHAR(20) NOT NULL REFERENCES materia(codigo),
    dni_profesor VARCHAR(20) REFERENCES profesor(dni),
    FOREIGN KEY (dni_alumno, id_curso, id_ciclo_lectivo)
        REFERENCES alumno_curso(dni_alumno, id_curso, id_ciclo_lectivo),
    UNIQUE (dni_alumno, codigo_materia, tipo_evaluacion, id_ciclo_lectivo)
);

CREATE INDEX IF NOT EXISTS idx_alumno_curso_ciclo ON alumno_curso(id_ciclo_lectivo, id_curso);
CREATE INDEX IF NOT EXISTS idx_nota_alumno ON nota(dni_alumno);
CREATE INDEX IF NOT EXISTS idx_nota_materia ON nota(codigo_materia);
CREATE INDEX IF NOT EXISTS idx_nota_ciclo_fecha
    ON nota(id_ciclo_lectivo, fecha DESC, id_nota DESC);

CREATE TABLE IF NOT EXISTS nota_individual (
    id_nota_individual SERIAL PRIMARY KEY,
    dni_alumno VARCHAR(20) NOT NULL,
    id_curso INTEGER NOT NULL,
    id_ciclo_lectivo INTEGER NOT NULL,
    codigo_materia VARCHAR(20) NOT NULL REFERENCES materia(codigo),
    tipo_evaluacion VARCHAR(30) NOT NULL
        CHECK (tipo_evaluacion IN ('BIMESTRE_1','BIMESTRE_2','BIMESTRE_3','BIMESTRE_4','DICIEMBRE','FEBRERO')),
    tema TEXT NOT NULL CHECK (LENGTH(TRIM(tema)) > 0),
    estado VARCHAR(20) NOT NULL CHECK (estado IN ('No realizó','Entregado')),
    calificacion NUMERIC(4,2) NOT NULL CHECK (calificacion BETWEEN 1 AND 10),
    adeuda BOOLEAN,
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    dni_profesor VARCHAR(20) REFERENCES profesor(dni),
    FOREIGN KEY (dni_alumno, id_curso, id_ciclo_lectivo)
        REFERENCES alumno_curso(dni_alumno, id_curso, id_ciclo_lectivo) ON DELETE CASCADE,
    CHECK (estado <> 'No realizó' OR calificacion = 1)
);

ALTER TABLE nota_individual ADD COLUMN IF NOT EXISTS adeuda BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_nota_individual_contexto
    ON nota_individual(dni_alumno, codigo_materia, id_ciclo_lectivo, tipo_evaluacion);

CREATE TABLE IF NOT EXISTS notificacion_alumno (
    id_notificacion SERIAL PRIMARY KEY,
    dni_alumno VARCHAR(20) NOT NULL REFERENCES alumno(dni) ON DELETE CASCADE,
    titulo VARCHAR(150) NOT NULL,
    mensaje TEXT NOT NULL,
    fecha TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notificacion_alumno_fecha
    ON notificacion_alumno(dni_alumno, fecha DESC);

-- Catálogos iniciales compartidos por los ciclos lectivos.
INSERT INTO turno (jornada, hora_inicio, hora_fin, entrada_prehora, salida_poshora, id_ciclo_lectivo)
SELECT 'Mañana', '07:40', '12:10', '07:10', '12:50', id_ciclo_lectivo
FROM ciclo_lectivo WHERE anio=EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
AND NOT EXISTS (
    SELECT 1 FROM turno
    WHERE jornada='Mañana' AND id_ciclo_lectivo=ciclo_lectivo.id_ciclo_lectivo
);

INSERT INTO turno (jornada, hora_inicio, hora_fin, entrada_prehora, salida_poshora, id_ciclo_lectivo)
SELECT 'Tarde', '13:30', '18:00', '12:50', '18:40', id_ciclo_lectivo
FROM ciclo_lectivo WHERE anio=EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
AND NOT EXISTS (
    SELECT 1 FROM turno
    WHERE jornada='Tarde' AND id_ciclo_lectivo=ciclo_lectivo.id_ciclo_lectivo
);

INSERT INTO turno (jornada, hora_inicio, hora_fin, entrada_prehora, salida_poshora, id_ciclo_lectivo)
SELECT 'Noche', '18:10', '22:40', '17:30', '23:20', id_ciclo_lectivo
FROM ciclo_lectivo WHERE anio=EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
AND NOT EXISTS (
    SELECT 1 FROM turno
    WHERE jornada='Noche' AND id_ciclo_lectivo=ciclo_lectivo.id_ciclo_lectivo
);

INSERT INTO especialidad (nombre)
VALUES ('Automotores'), ('Computación')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO materia (codigo, nombre)
VALUES
    ('MAT', 'Matemática'),
    ('LEN', 'Lengua y Literatura'),
    ('PPP', 'Prácticas Profesionalizantes'),
    ('PRED', 'Programación sobre Redes'),
    ('EF', 'Educación Física')
ON CONFLICT (codigo) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM app_schema_migration WHERE nombre='ciclo_materia_por_ciclo_v1'
    ) THEN
        INSERT INTO ciclo_materia (id_ciclo_lectivo, codigo_materia, nombre)
        SELECT cl.id_ciclo_lectivo, m.codigo, m.nombre
        FROM ciclo_lectivo cl
        CROSS JOIN materia m
        ON CONFLICT (id_ciclo_lectivo, codigo_materia) DO NOTHING;

        INSERT INTO app_schema_migration (nombre)
        VALUES ('ciclo_materia_por_ciclo_v1');
    END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO administrador (dni, nombre, apellido, email, cargo)
VALUES ('00000000', 'Admin', 'Sistema', 'admin@gestionnotas.test', 'Administrador')
ON CONFLICT (dni) DO NOTHING;

INSERT INTO rol (nombre, descripcion)
VALUES ('admin', 'Acceso administrativo')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO usuario (
    nombre_usuario,
    contrasenia,
    estado,
    dni_administrador,
    id_rol
)
SELECT
    '00000000',
    crypt('admin123', gen_salt('bf', 10)),
    'Activo',
    '00000000',
    id_rol
FROM rol
WHERE nombre = 'admin'
ON CONFLICT (nombre_usuario) DO NOTHING;