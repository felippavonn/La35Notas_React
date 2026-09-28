# la35Notas — React + Express + PostgreSQL

Migración de la aplicación anterior a una única estructura de proyecto.

## Estructura

```text
La35Notas_React/
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── styles.css
│   └── services/api.js
├── server.js
├── index.html
├── package.json
├── vite.config.js
├── eslint.config.js
├── .env.example
└── start.bat
```

Ya no hay un segundo `package.json`, ni otro `index.html`, ni un `api.js` global para manipular el DOM. React se encarga de la interfaz y `src/services/api.js` de las llamadas HTTP.

## Requisitos

- Node.js
- PostgreSQL con la base `gestion_notas` y el esquema del proyecto ya creado.

## Instalación

1. Copiar `.env.example` como `.env`.
2. Cambiar `DB_PASSWORD` por la contraseña local de PostgreSQL.
3. Ejecutar:

```bash
npm install
```

## Ejecutar en desarrollo

Abrí dos terminales:

```bash
npm run server
```

```bash
npm run dev
```

O usá `start.bat` para abrir ambos procesos en ventanas separadas.

La interfaz queda normalmente en `http://localhost:5173` y el backend en `http://localhost:3000`.

Vite redirige `/api/*` al backend, así que React no necesita una URL hardcodeada.

## Ejecutar como aplicación compilada

```bash
npm run build
npm run server
```

Cuando existe `dist/`, Express la sirve desde `http://localhost:3000`.

## Usuarios de demo

Todos usan contraseña `1234`:

| Usuario | Rol |
|---|---|
| `admin` | Administrador |
| `31928371` | Profesor |
| `96103383` | Alumno |
| `preceptor` | Preceptor |

El backend crea esos usuarios automáticamente si las tablas correspondientes ya existen.

## Qué quedó conectado

- Login real contra PostgreSQL.
- Sesión persistida en `localStorage` mediante token de memoria del backend.
- Dashboard con datos reales.
- Listado y filtros de alumnos.
- Alta y modificación de alumnos según rol.
- Listado de docentes.
- Listado de cursos.
- Listado de materias.
- Carga y edición de calificaciones.
- Promedio sugerido para bimestre 1 + bimestre 2.
- Consulta de calificaciones del alumno.
- Notificaciones y alertas a partir de las notas.

## Nota

El esquema SQL no se modifica en esta migración. Se conserva la base de datos existente del proyecto para evitar cambiar el modelo conceptual ya trabajado.
