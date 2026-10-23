-- Esquema inicial de Gestión de Notas. Aplicar solo sobre una base vacía.
BEGIN;

CREATE EXTENSION pgcrypto;

CREATE TABLE ciclo_lectivo (
  id_ciclo_lectivo SERIAL PRIMARY KEY,
  anio INTEGER NOT NULL UNIQUE CHECK (anio BETWEEN 1900 AND 2200)
);

CREATE TABLE turno (
  id_turno SERIAL PRIMARY KEY,
  jornada VARCHAR(30) NOT NULL UNIQUE CHECK (jornada IN ('Mañana', 'Tarde', 'Noche'))
);

INSERT INTO turno (jornada) VALUES ('Mañana'), ('Tarde'), ('Noche');

CREATE TABLE especialidad (
  id_especialidad SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE
);

INSERT INTO especialidad (nombre) VALUES ('Automotores'), ('Computación');

CREATE TABLE materia (
  codigo VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL
);

INSERT INTO materia (codigo, nombre) VALUES
  ('MAT', 'Matemática'),
  ('LEN', 'Lengua y Literatura'),
  ('PPP', 'Prácticas Profesionalizantes'),
  ('PRED', 'Programación sobre Redes'),
  ('EF', 'Educación Física'),
  ('ING', 'Inglés'),
  ('HIS', 'Historia'),
  ('DDS', 'Desarrollo de Sistemas'),
  ('ASR', 'Administración de Sistemas y Redes'),
  ('RED', 'Redes'),
  ('BDD', 'Base de Datos'),
  ('GABD', 'Gestión y Administración de Base de Datos'),
  ('FIS', 'Física'),
  ('QUI', 'Química'),
  ('GPP', 'Gestión de los Procesos Productivos'),
  ('CYT', 'Ciencia y Tecnología'),
  ('CITT', 'Ciudadanía y Trabajo'),
  ('ECI', 'Educación Ciudadana'),
  ('DTEC', 'Dibujo Técnico');

CREATE TABLE ciclo_materia (
  id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo) ON DELETE CASCADE,
  codigo_materia VARCHAR(20) NOT NULL REFERENCES materia(codigo) ON DELETE CASCADE,
  PRIMARY KEY (id_ciclo_lectivo, codigo_materia)
);

CREATE TABLE curso (
  id_curso SERIAL PRIMARY KEY,
  anio INTEGER NOT NULL CHECK (anio BETWEEN 1 AND 6),
  division VARCHAR(10) NOT NULL,
  id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo) ON DELETE CASCADE,
  id_especialidad INTEGER REFERENCES especialidad(id_especialidad),
  UNIQUE (id_curso, id_ciclo_lectivo),
  CHECK (
    (anio IN (1, 2) AND id_especialidad IS NULL)
    OR (anio BETWEEN 3 AND 6 AND id_especialidad IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_curso_anio_especialidad_ciclo
  ON curso(anio, id_especialidad, id_ciclo_lectivo)
  WHERE id_especialidad IS NOT NULL;

CREATE UNIQUE INDEX idx_curso_basico_anio_division_ciclo
  ON curso(anio, division, id_ciclo_lectivo)
  WHERE anio IN (1, 2) AND id_especialidad IS NULL;

CREATE TABLE curso_turno (
  id_curso INTEGER PRIMARY KEY REFERENCES curso(id_curso) ON DELETE CASCADE,
  id_turno INTEGER REFERENCES turno(id_turno) ON DELETE SET NULL
);

CREATE TABLE curso_materia (
  id_curso INTEGER NOT NULL,
  codigo_materia VARCHAR(20) NOT NULL REFERENCES materia(codigo),
  id_ciclo_lectivo INTEGER NOT NULL,
  PRIMARY KEY (id_curso, codigo_materia, id_ciclo_lectivo),
  FOREIGN KEY (id_curso, id_ciclo_lectivo)
    REFERENCES curso(id_curso, id_ciclo_lectivo) ON DELETE CASCADE
);

CREATE TABLE domicilio (
  id_domicilio SERIAL PRIMARY KEY,
  calle VARCHAR(100) NOT NULL,
  numero_calle VARCHAR(10),
  departamento VARCHAR(50),
  localidad VARCHAR(80) NOT NULL
);

CREATE TABLE alumno (
  dni VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  apellido VARCHAR(80) NOT NULL,
  fecha_nacimiento DATE,
  genero VARCHAR(30),
  nacionalidad VARCHAR(60),
  email VARCHAR(150),
  estado VARCHAR(30) NOT NULL DEFAULT 'Activo' CHECK (
    estado IN ('Activo', 'Egresado', 'Baja', 'Suspendido', 'Transferido', 'No corresponde')
  ),
  id_domicilio INTEGER REFERENCES domicilio(id_domicilio)
);

CREATE TABLE alumno_curso (
  dni_alumno VARCHAR(20) NOT NULL REFERENCES alumno(dni) ON DELETE CASCADE,
  id_curso INTEGER NOT NULL,
  id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
  fecha_inscripcion DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_baja DATE,
  PRIMARY KEY (dni_alumno, id_curso, id_ciclo_lectivo),
  FOREIGN KEY (id_curso, id_ciclo_lectivo)
    REFERENCES curso(id_curso, id_ciclo_lectivo),
  CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_inscripcion)
);

CREATE UNIQUE INDEX idx_alumno_curso_vigente
  ON alumno_curso(dni_alumno, id_ciclo_lectivo)
  WHERE fecha_baja IS NULL;
CREATE INDEX idx_alumno_curso_ciclo ON alumno_curso(id_ciclo_lectivo, id_curso);

CREATE TABLE profesor (
  dni VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  apellido VARCHAR(80) NOT NULL,
  email VARCHAR(150),
  telefono VARCHAR(30),
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo' CHECK (estado IN ('Activo', 'Baja')),
  id_domicilio INTEGER REFERENCES domicilio(id_domicilio)
);

CREATE TABLE preceptor (
  dni VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  apellido VARCHAR(80) NOT NULL,
  email VARCHAR(150),
  telefono VARCHAR(30),
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo' CHECK (estado IN ('Activo', 'Baja'))
);

CREATE TABLE administrador (
  dni VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  apellido VARCHAR(80) NOT NULL,
  email VARCHAR(150),
  telefono VARCHAR(30),
  cargo VARCHAR(30) CHECK (cargo IN ('Regente', 'Subregente') OR cargo IS NULL),
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo' CHECK (estado IN ('Activo', 'Baja'))
);

CREATE TABLE adulto_responsable (
  dni VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  apellido VARCHAR(80) NOT NULL,
  telefono VARCHAR(30),
  email VARCHAR(150)
);

CREATE TABLE responsables_alumnos (
  dni_responsable VARCHAR(20) REFERENCES adulto_responsable(dni) ON DELETE CASCADE,
  dni_alumno VARCHAR(20) REFERENCES alumno(dni) ON DELETE CASCADE,
  PRIMARY KEY (dni_responsable, dni_alumno)
);

CREATE TABLE rol (
  id_rol SERIAL PRIMARY KEY,
  nombre VARCHAR(40) UNIQUE NOT NULL,
  descripcion TEXT
);

CREATE TABLE usuario (
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
  CHECK (num_nonnulls(dni_alumno, dni_profesor, dni_preceptor, dni_administrador) <= 1)
);

CREATE TABLE profesor_rol (
  dni_profesor VARCHAR(20) REFERENCES profesor(dni) ON DELETE CASCADE,
  id_rol INTEGER REFERENCES rol(id_rol) ON DELETE CASCADE,
  PRIMARY KEY (dni_profesor, id_rol)
);

CREATE TABLE profesor_materia (
  dni_profesor VARCHAR(20) NOT NULL REFERENCES profesor(dni) ON DELETE CASCADE,
  codigo_materia VARCHAR(20) NOT NULL REFERENCES materia(codigo) ON DELETE CASCADE,
  id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
  PRIMARY KEY (dni_profesor, codigo_materia, id_ciclo_lectivo)
);

CREATE TABLE profesor_curso_materia (
  dni_profesor VARCHAR(20) REFERENCES profesor(dni) ON DELETE CASCADE,
  id_curso INTEGER NOT NULL,
  codigo_materia VARCHAR(20) REFERENCES materia(codigo) ON DELETE CASCADE,
  id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
  PRIMARY KEY (dni_profesor, id_curso, codigo_materia, id_ciclo_lectivo),
  FOREIGN KEY (id_curso, id_ciclo_lectivo)
    REFERENCES curso(id_curso, id_ciclo_lectivo) ON DELETE CASCADE,
  FOREIGN KEY (id_curso, codigo_materia, id_ciclo_lectivo)
    REFERENCES curso_materia(id_curso, codigo_materia, id_ciclo_lectivo) ON DELETE CASCADE
);

CREATE TABLE nota (
  id_nota SERIAL PRIMARY KEY,
  calificacion NUMERIC(4, 2) CHECK (calificacion BETWEEN 1 AND 10),
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

CREATE INDEX idx_nota_alumno ON nota(dni_alumno);
CREATE INDEX idx_nota_materia ON nota(codigo_materia);
CREATE INDEX idx_nota_ciclo_fecha ON nota(id_ciclo_lectivo, fecha DESC, id_nota DESC);

CREATE TABLE nota_individual (
  id_nota_individual SERIAL PRIMARY KEY,
  dni_alumno VARCHAR(20) NOT NULL,
  id_curso INTEGER NOT NULL,
  id_ciclo_lectivo INTEGER NOT NULL,
  codigo_materia VARCHAR(20) NOT NULL REFERENCES materia(codigo),
  tipo_evaluacion VARCHAR(30) NOT NULL CHECK (
    tipo_evaluacion IN ('BIMESTRE_1', 'BIMESTRE_2', 'BIMESTRE_3', 'BIMESTRE_4', 'DICIEMBRE', 'FEBRERO')
  ),
  tema TEXT NOT NULL CHECK (LENGTH(TRIM(tema)) > 0),
  estado VARCHAR(20) NOT NULL CHECK (estado IN ('No realizó', 'Entregado')),
  calificacion NUMERIC(4, 2) NOT NULL CHECK (calificacion BETWEEN 1 AND 10),
  adeuda BOOLEAN,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  dni_profesor VARCHAR(20) REFERENCES profesor(dni),
  FOREIGN KEY (dni_alumno, id_curso, id_ciclo_lectivo)
    REFERENCES alumno_curso(dni_alumno, id_curso, id_ciclo_lectivo) ON DELETE CASCADE,
  CHECK (estado <> 'No realizó' OR calificacion = 1)
);

CREATE INDEX idx_nota_individual_contexto
  ON nota_individual(dni_alumno, codigo_materia, id_ciclo_lectivo, tipo_evaluacion);

CREATE TABLE notificacion_alumno (
  id_notificacion SERIAL PRIMARY KEY,
  dni_alumno VARCHAR(20) NOT NULL REFERENCES alumno(dni) ON DELETE CASCADE,
  titulo VARCHAR(150) NOT NULL,
  mensaje TEXT NOT NULL,
  fecha TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notificacion_alumno_fecha ON notificacion_alumno(dni_alumno, fecha DESC);

INSERT INTO ciclo_lectivo (anio) VALUES (2026);
INSERT INTO ciclo_materia (id_ciclo_lectivo, codigo_materia)
SELECT cl.id_ciclo_lectivo, m.codigo
FROM ciclo_lectivo cl CROSS JOIN materia m
WHERE cl.anio = 2026;

INSERT INTO curso (anio, division, id_ciclo_lectivo, id_especialidad)
SELECT years.anio, '1', cl.id_ciclo_lectivo, e.id_especialidad
FROM generate_series(1, 6) AS years(anio)
CROSS JOIN ciclo_lectivo cl
LEFT JOIN especialidad e ON years.anio >= 3
WHERE cl.anio = 2026;

INSERT INTO administrador (dni, nombre, apellido, email, cargo)
VALUES ('1', 'Admin', 'Sistema', 'admin@gestionnotas.test', 'Regente');
INSERT INTO preceptor (dni, nombre, apellido, email)
VALUES ('2', 'Preceptor', 'Demo', 'preceptor@gestionnotas.test');
INSERT INTO profesor (dni, nombre, apellido, email)
VALUES ('3', 'Profesor', 'Demo', 'profesor@gestionnotas.test');
INSERT INTO alumno (dni, nombre, apellido, email)
VALUES ('4', 'Alumno', 'Demo', 'alumno@gestionnotas.test');

INSERT INTO rol (nombre, descripcion) VALUES
  ('admin', 'Acceso administrativo'),
  ('preceptor', 'Acceso de preceptoría'),
  ('profesor', 'Acceso docente'),
  ('alumno', 'Acceso de alumno');

INSERT INTO usuario (nombre_usuario, contrasenia, estado, dni_administrador, id_rol)
SELECT '1', crypt('1', gen_salt('bf', 10)), 'Activo', '1', id_rol
FROM rol WHERE nombre = 'admin';
INSERT INTO usuario (nombre_usuario, contrasenia, estado, dni_preceptor, id_rol)
SELECT '2', crypt('2', gen_salt('bf', 10)), 'Activo', '2', id_rol
FROM rol WHERE nombre = 'preceptor';
INSERT INTO usuario (nombre_usuario, contrasenia, estado, dni_profesor, id_rol)
SELECT '3', crypt('3', gen_salt('bf', 10)), 'Activo', '3', id_rol
FROM rol WHERE nombre = 'profesor';
INSERT INTO usuario (nombre_usuario, contrasenia, estado, dni_alumno, id_rol)
SELECT '4', crypt('4', gen_salt('bf', 10)), 'Activo', '4', id_rol
FROM rol WHERE nombre = 'alumno';

COMMIT;
