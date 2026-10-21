BEGIN;

DO $$
BEGIN
  IF to_regclass('public.curso') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='curso'
      AND column_name='ciclo_lectivo'
  ) THEN
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS ciclo_lectivo (
    id_ciclo_lectivo SERIAL PRIMARY KEY,
    anio INTEGER NOT NULL UNIQUE CHECK (anio BETWEEN 1900 AND 2200)
  );

  INSERT INTO ciclo_lectivo (anio)
  SELECT DISTINCT ciclo_lectivo FROM curso
  ON CONFLICT (anio) DO NOTHING;

  ALTER TABLE curso
    ADD COLUMN id_ciclo_lectivo INTEGER REFERENCES ciclo_lectivo(id_ciclo_lectivo);

  UPDATE curso c
  SET id_ciclo_lectivo=cl.id_ciclo_lectivo
  FROM ciclo_lectivo cl
  WHERE cl.anio=c.ciclo_lectivo;

  ALTER TABLE curso ALTER COLUMN id_ciclo_lectivo SET NOT NULL;
  ALTER TABLE curso DROP CONSTRAINT IF EXISTS curso_anio_division_ciclo_lectivo_key;
  ALTER TABLE curso ADD CONSTRAINT curso_anio_division_ciclo_key
    UNIQUE (anio, division, id_ciclo_lectivo);
  ALTER TABLE curso ADD CONSTRAINT curso_id_curso_ciclo_key
    UNIQUE (id_curso, id_ciclo_lectivo);

  CREATE TABLE alumno_curso (
    dni_alumno VARCHAR(20) NOT NULL REFERENCES alumno(dni) ON DELETE CASCADE,
    id_curso INTEGER NOT NULL REFERENCES curso(id_curso),
    id_ciclo_lectivo INTEGER NOT NULL REFERENCES ciclo_lectivo(id_ciclo_lectivo),
    fecha_inscripcion DATE NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY (dni_alumno, id_curso, id_ciclo_lectivo),
    FOREIGN KEY (id_curso, id_ciclo_lectivo)
      REFERENCES curso(id_curso, id_ciclo_lectivo)
  );

  ALTER TABLE alumno_curso ADD COLUMN fecha_baja DATE;
  ALTER TABLE alumno_curso
    ADD CONSTRAINT alumno_curso_fechas_check
    CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_inscripcion);

  CREATE UNIQUE INDEX idx_alumno_curso_vigente
    ON alumno_curso(dni_alumno, id_ciclo_lectivo)
    WHERE fecha_baja IS NULL;

  INSERT INTO alumno_curso (dni_alumno, id_curso, id_ciclo_lectivo)
  SELECT a.dni, c.id_curso, c.id_ciclo_lectivo
  FROM alumno a
  JOIN curso c ON c.id_curso=a.id_curso
  ON CONFLICT DO NOTHING;

  ALTER TABLE profesor_curso_materia
    ADD COLUMN id_ciclo_lectivo INTEGER REFERENCES ciclo_lectivo(id_ciclo_lectivo);

  UPDATE profesor_curso_materia pcm
  SET id_ciclo_lectivo=c.id_ciclo_lectivo
  FROM curso c
  WHERE c.id_curso=pcm.id_curso;

  ALTER TABLE profesor_curso_materia ALTER COLUMN id_ciclo_lectivo SET NOT NULL;
  ALTER TABLE profesor_curso_materia
    DROP CONSTRAINT profesor_curso_materia_pkey;
  ALTER TABLE profesor_curso_materia
    ADD CONSTRAINT profesor_curso_materia_pkey
    PRIMARY KEY (dni_profesor, id_curso, codigo_materia, id_ciclo_lectivo);
  ALTER TABLE profesor_curso_materia
    ADD CONSTRAINT profesor_curso_materia_curso_ciclo_fkey
    FOREIGN KEY (id_curso, id_ciclo_lectivo)
    REFERENCES curso(id_curso, id_ciclo_lectivo) ON DELETE CASCADE;

  ALTER TABLE nota ADD COLUMN id_curso INTEGER;
  ALTER TABLE nota
    ADD COLUMN id_ciclo_lectivo INTEGER REFERENCES ciclo_lectivo(id_ciclo_lectivo);

  UPDATE nota n
  SET id_curso=ac.id_curso,
      id_ciclo_lectivo=ac.id_ciclo_lectivo
  FROM alumno_curso ac
  WHERE ac.dni_alumno=n.dni_alumno;

  ALTER TABLE nota
    DROP CONSTRAINT IF EXISTS nota_dni_alumno_codigo_materia_tipo_evaluacion_key;
  ALTER TABLE nota
    ADD CONSTRAINT nota_alumno_curso_ciclo_fkey
    FOREIGN KEY (dni_alumno, id_curso, id_ciclo_lectivo)
    REFERENCES alumno_curso(dni_alumno, id_curso, id_ciclo_lectivo);
  ALTER TABLE nota
    ADD CONSTRAINT nota_alumno_materia_evaluacion_ciclo_key
    UNIQUE (dni_alumno, codigo_materia, tipo_evaluacion, id_ciclo_lectivo);

  DROP INDEX IF EXISTS idx_alumno_curso;
  ALTER TABLE alumno DROP COLUMN id_curso;
  ALTER TABLE curso DROP COLUMN ciclo_lectivo;

  CREATE INDEX IF NOT EXISTS idx_alumno_curso_ciclo
    ON alumno_curso(id_ciclo_lectivo, id_curso);
  CREATE INDEX IF NOT EXISTS idx_nota_ciclo ON nota(id_ciclo_lectivo);
END $$;

COMMIT;