# la35Notas

Sistema de gestión escolar para administrar alumnos, docentes, cursos y
calificaciones. La interfaz está desarrollada con React y Vite; la API utiliza
Express y PostgreSQL.

## Estructura

```text
La35Notas_React/
├── database/
│   └── schema.sql
├── scripts/
│   └── init-db.cjs
├── src/
│   ├── assets/
│   │   └── escudo.png
│   ├── services/
│   │   └── api.js
│   ├── utils/
│   │   └── bulletinPdf.js
│   ├── App.jsx
│   ├── main.jsx
│   └── styles.css
├── server.js
├── index.html
├── package.json
├── eslint.config.js
├── vite.config.js
├── start.bat
├── .env.example
└── .gitignore
```

React controla la interfaz y `src/services/api.js` centraliza las llamadas al
backend. `server.js` sirve la API y, cuando existe `dist/`, también la
aplicación compilada.

## Requisitos

- Node.js y npm
- PostgreSQL y una base de datos vacía para la inicialización

## Configuración

1. Copiá `.env.example` como `.env`.
2. Configurá `DATABASE_URL` con la conexión a PostgreSQL. Usá
   `DATABASE_SSL=true` si el proveedor requiere SSL.
3. Configurá `CORS_ORIGIN` con los orígenes permitidos en producción.
4. Instalá las dependencias:

   ```bash
   npm install
   ```

5. Aplicá el esquema inicial **una sola vez** sobre una base vacía:

   ```bash
   node scripts/init-db.cjs
   ```


Esta versión concentra la definición de base en `database/schema.sql`.
El comando de inicialización requiere una base vacía. Para llevar datos de una
instalación anterior, conservá una copia de seguridad y planificá la
transferencia a la nueva estructura antes de desplegarla.

## Desarrollo local

En terminales separadas, ejecutá:

```bash
npm run server
npm run dev
```

La interfaz queda disponible normalmente en `http://localhost:5173` y la API
en `http://localhost:3000`. En desarrollo, Vite redirige las solicitudes
`/api` al servidor.

En Windows también podés iniciar ambos procesos con `start.bat`.

Para compilar y servir la aplicación desde Express:

```bash
npm run build
npm run server
```

## Funcionalidades

- Acceso por DNI y contraseña, con sesión persistente.
- Panel general con actividad reciente, alumnos activos y calificaciones.
- Administración y consulta de alumnos, docentes, cursos, materias y ciclos
  lectivos según los permisos del rol.
- Asignación de materias y cursos a docentes.
- Estados docentes `Activo`, `Licencia`, `Suplente` y `Baja`. Un docente en
  licencia puede designar a un suplente; este hereda las materias y cursos de
  la licencia y no puede recibir asignaciones propias. El docente en licencia
  no puede cargar ni modificar calificaciones.
- Carga de calificaciones generales y evaluaciones individuales, con
  notificaciones y consulta de boletines.
- Interfaz con identidad visual roja, escudo institucional y navegación
  lateral desplazable. Los botones de acción conservan sus colores, excepto el
  botón de acceso del login.

## Cambios de la entrevista 3

- **Planes de estudio.** Administración puede crear, editar, duplicar y eliminar
  planes sin cursos asociados. El Ciclo Básico abarca 1.º y 2.º y el Ciclo
  Superior abarca 3.º a 6.º con Automotores o Computación. Motores es la misma
  especialidad que Automotores.
- **Materias y cursos.** Las materias se dan de alta con descripción, plan y
  año. Una materia del catálogo se puede reutilizar en varios planes y años.
  Cada curso guarda su división y plan para el ciclo lectivo seleccionado.
  Las materias del curso deben pertenecer a su plan y año y cada código se
  asigna una vez. La copia de ciclo conserva divisiones, planes, materias y
  asignaciones de personal.
- **Datos e historial del alumno.** La ficha admite domicilio, fecha de
  nacimiento, género y nacionalidad. El historial muestra inscripciones
  vigentes y cerradas, con notas generales y evaluaciones individuales. El
  cambio de curso conserva las notas en su inscripción de origen. El PDF
  incluye los cursos que figuran en el boletín del ciclo.
- **Calificación definitiva.** Si se carga explícitamente, es la que aparece
  en la última columna del boletín. Si se deja vacía, se toma la primera que
  esté disponible entre Febrero, Diciembre y Final, en ese orden.
- **Asignaciones de personal.** Los docentes actúan sobre sus combinaciones
  de curso y materia, incluida la suplencia vigente. Los preceptores consultan
  sus cursos y materias asignados en cada ciclo. Administración puede habilitar
  acciones de edición y carga de notas desde **Preceptores → Permisos**.

Tras inicializar la base, completá **Planes de estudio** con la grilla oficial
y vinculá sus materias desde **Cursos**. Los planes iniciales tienen la grilla
vacía. Para una nueva grilla a partir de otro ciclo, duplicá el plan y
seleccioná la nueva versión en los cursos correspondientes.

## Cuentas de demostración

En la inicialización de una base vacía, las cuentas iniciales usan el DNI como
nombre de usuario y contraseña:

| DNI | Rol |
| --- | --- |
| `1` | Administrador |
| `2` | Preceptor |
| `3` | Profesor |
| `4` | Alumno |

Al crear personas desde la aplicación, el backend genera o sincroniza las
cuentas correspondientes y usa el DNI como contraseña inicial.

## Despliegue

- **Render:** compilá con `npm install --include=dev && npm run build` e iniciá
  con `npm run server`. Configurá `DATABASE_URL`, `DATABASE_SSL` y
  `CORS_ORIGIN`. No ejecutes `scripts/init-db.cjs` en cada build.
- **Cloudflare Pages:** usá `npm run build` y `dist` como directorio de salida.
  Configurá `VITE_API_URL` con la URL pública de la API terminada en `/api`.

## Documentación

Toda la documentación [aquí](https://docs.google.com/document/d/1YNk5Wdl-58kTK-WZ4SZtEhY0vVsbr6wP6rKi8fzUTl0/edit?usp=sharing)
