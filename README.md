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

El esquema no contiene migraciones y no actualiza bases existentes. Antes de
usar estos cambios en una instalación previa, realizá una copia de seguridad y
prepará la migración correspondiente.

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
