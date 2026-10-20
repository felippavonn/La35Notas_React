import { useEffect, useMemo, useState } from 'react'
import { apiFetch, clearSession, getStoredUser, login, logout, setStoredUser } from './services/api'

const DEMO_USERS = {
  admin: 'admin',
  profesor: '31928371',
  alumno: '96103383',
  preceptor: 'preceptor',
}

const ROLE_LABELS = {
  admin: 'Administrador',
  profesor: 'Profesor / Docente',
  alumno: 'Alumno',
  preceptor: 'Preceptor',
}

const EVALUACIONES = [
  ['BIMESTRE_1', '1er Bimestre'],
  ['BIMESTRE_2', '2do Bimestre'],
  ['CUATRIMESTRE_1', '1er Cuatrimestre'],
  ['FINAL', 'Final'],
]

function App() {
  const [session, setSession] = useState(getStoredUser())
  const [loginUser, setLoginUser] = useState('admin')
  const [loginPass, setLoginPass] = useState('1234')
  const [loginRole, setLoginRole] = useState('admin')
  const [loginLoading, setLoginLoading] = useState(false)

  const [page, setPage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState([])
  const [loading, setLoading] = useState(false)
  const [globalError, setGlobalError] = useState('')

  const [alumnos, setAlumnos] = useState([])
  const [docentes, setDocentes] = useState([])
  const [cursos, setCursos] = useState([])
  const [materias, setMaterias] = useState([])
  const [notas, setNotas] = useState([])
  const [dashboard, setDashboard] = useState({ alumnos_activos: 0, aprobados: 0, contenidos_incompletos: 0 })
  const [notificaciones, setNotificaciones] = useState([])
  const [misNotas, setMisNotas] = useState([])

  const [search, setSearch] = useState('')
  const [filterCurso, setFilterCurso] = useState('')
  const [filterEstado, setFilterEstado] = useState('')
  const [notaCurso, setNotaCurso] = useState('')
  const [notaMateria, setNotaMateria] = useState('')
  const [notaPeriodo, setNotaPeriodo] = useState('BIMESTRE_1')

  const [modalAlumno, setModalAlumno] = useState(null)
  const [modalNota, setModalNota] = useState(null)
  const [newAlumno, setNewAlumno] = useState({
    dni: '',
    nombre: '',
    apellido: '',
    email: '',
    id_curso: '',
    estado: 'Activo',
  })
  const [notaForm, setNotaForm] = useState({
    BIMESTRE_1: '',
    BIMESTRE_2: '',
    CUATRIMESTRE_1: '',
    FINAL: '',
    observacion: '',
  })

  const isAlumno = session?.rol === 'alumno'
  const canManageStudents = session?.rol === 'admin' || session?.rol === 'preceptor'
  const canManageNotes = ['admin', 'profesor', 'preceptor'].includes(session?.rol)

  function pushToast(message, type = 'ok') {
    const id = Date.now() + Math.random()
    setToast((items) => [...items, { id, message, type }])
    setTimeout(() => setToast((items) => items.filter((item) => item.id !== id)), 3200)
  }

  async function loadCoreData() {
    if (!session) return
    setLoading(true)
    setGlobalError('')
    try {
      const [dash, alumnosData, cursosData, materiasData] = await Promise.all([
        apiFetch('/dashboard'),
        apiFetch('/alumnos'),
        apiFetch('/cursos'),
        apiFetch('/materias'),
      ])
      setDashboard(dash)
      setAlumnos(alumnosData)
      setCursos(cursosData)
      setMaterias(materiasData)

      if (!isAlumno) {
        const [docentesData, notifData] = await Promise.all([
          apiFetch('/docentes'),
          apiFetch('/notificaciones'),
        ])
        setDocentes(docentesData)
        setNotificaciones(notifData)
      } else {
        setMisNotas(await apiFetch('/mis-notas'))
      }
    } catch (error) {
      setGlobalError(error.message)
      if (/No autenticado/i.test(error.message)) {
        clearSession()
        setSession(null)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) loadCoreData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id_usuario, session?.rol])

  async function handleLogin(event) {
    event.preventDefault()
    setLoginLoading(true)
    try {
      const user = await login(loginUser.trim(), loginPass)
      setSession(user)
      setPage(user.rol === 'alumno' ? 'consulta' : 'dashboard')
      pushToast(`Sesión iniciada como ${ROLE_LABELS[user.rol] || user.rol}`)
    } catch (error) {
      pushToast(error.message, 'warn')
    } finally {
      setLoginLoading(false)
    }
  }

  async function handleLogout() {
    try {
      await logout()
    } finally {
      setSession(null)
      setPage('dashboard')
    }
  }

  function selectDemoRole(role) {
    setLoginRole(role)
    setLoginUser(DEMO_USERS[role])
    setLoginPass('1234')
  }

  function navigate(nextPage) {
    if (nextPage === 'alumnos' && isAlumno) return
    if (nextPage === 'notas' && !canManageNotes) return
    setPage(nextPage)
    setSidebarOpen(false)
  }

  const filteredAlumnos = useMemo(() => {
    const term = search.trim().toLowerCase()
    return alumnos.filter((alumno) => {
      const nombreCompleto = `${alumno.apellido || ''} ${alumno.nombre || ''}`.trim().toLowerCase()
      const matchSearch = !term || nombreCompleto.includes(term) || String(alumno.dni).includes(term)
      const matchCurso = !filterCurso || String(alumno.id_curso) === String(filterCurso)
      const matchEstado = !filterEstado || String(alumno.estado).toLowerCase() === filterEstado.toLowerCase()
      return matchSearch && matchCurso && matchEstado
    })
  }, [alumnos, search, filterCurso, filterEstado])

  const noteRows = useMemo(() => {
    const map = new Map()
    notas.forEach((row) => {
      if (!row.dni) return
      const current = map.get(row.dni) || {
        dni: row.dni,
        nombre: `${row.apellido} ${row.nombre}`.trim(),
        curso: `${row.anio ?? ''}° ${row.division ?? ''}`.trim(),
        notas: {},
      }
      if (row.tipo_evaluacion) current.notas[row.tipo_evaluacion] = row.calificacion
      current.materia = row.materia
      map.set(row.dni, current)
    })
    return [...map.values()]
  }, [notas])

  async function loadNotas() {
    if (!notaCurso || !notaMateria) {
      setNotas([])
      return
    }
    try {
      const data = await apiFetch(`/notas?curso=${encodeURIComponent(notaCurso)}&materia=${encodeURIComponent(notaMateria)}`)
      setNotas(data)
    } catch (error) {
      pushToast(error.message, 'warn')
    }
  }

  useEffect(() => {
    if (page === 'notas' && notaCurso && notaMateria) loadNotas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, notaCurso, notaMateria])

  function resetNewAlumno() {
    setNewAlumno({ dni: '', nombre: '', apellido: '', email: '', id_curso: cursos[0]?.id_curso || '', estado: 'Activo' })
  }

  function openNewAlumno() {
    resetNewAlumno()
    setModalAlumno({ mode: 'new' })
  }

  function openEditAlumno(alumno) {
    setNewAlumno({
      dni: alumno.dni,
      nombre: alumno.nombre || '',
      apellido: alumno.apellido || '',
      email: alumno.email || '',
      id_curso: alumno.id_curso || '',
      estado: alumno.estado || 'Activo',
    })
    setModalAlumno({ mode: 'edit', alumno })
  }

  async function saveAlumno(event) {
    event.preventDefault()
    try {
      const body = {
        dni: newAlumno.dni.trim(),
        nombre: newAlumno.nombre.trim(),
        apellido: newAlumno.apellido.trim(),
        email: newAlumno.email.trim() || null,
        id_curso: newAlumno.id_curso || null,
        estado: newAlumno.estado,
      }
      if (modalAlumno.mode === 'new') {
        await apiFetch('/alumnos', { method: 'POST', body: JSON.stringify(body) })
        pushToast('Alumno guardado')
      } else {
        await apiFetch(`/alumnos/${encodeURIComponent(newAlumno.dni)}`, { method: 'PUT', body: JSON.stringify(body) })
        pushToast('Alumno actualizado')
      }
      setModalAlumno(null)
      await loadCoreData()
    } catch (error) {
      pushToast(error.message, 'warn')
    }
  }

  function openNotaModal(alumno) {
    const existing = noteRows.find((row) => row.dni === alumno.dni)?.notas || {}
    setNotaForm({
      BIMESTRE_1: existing.BIMESTRE_1 ?? '',
      BIMESTRE_2: existing.BIMESTRE_2 ?? '',
      CUATRIMESTRE_1: existing.CUATRIMESTRE_1 ?? '',
      FINAL: existing.FINAL ?? '',
      observacion: '',
    })
    setModalNota(alumno)
  }

  function suggestedAverage() {
    const values = [notaForm.BIMESTRE_1, notaForm.BIMESTRE_2]
      .map(Number)
      .filter((value, index) => notaForm[index === 0 ? 'BIMESTRE_1' : 'BIMESTRE_2'] !== '' && Number.isFinite(value))
    return values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : '—'
  }

  async function saveNotas(event) {
    event.preventDefault()
    if (!modalNota || !notaMateria) {
      pushToast('Seleccioná primero una materia', 'warn')
      return
    }
    try {
      const requests = Object.entries(notaForm)
        .filter(([key, value]) => key !== 'observacion' && value !== '')
        .map(([tipo_evaluacion, value]) => apiFetch('/notas', {
          method: 'POST',
          body: JSON.stringify({
            dni_alumno: modalNota.dni,
            codigo_materia: notaMateria,
            tipo_evaluacion,
            calificacion: Number(value),
            observacion: notaForm.observacion.trim() || null,
          }),
        }))

      if (!requests.length) {
        pushToast('Ingresá al menos una calificación', 'warn')
        return
      }

      await Promise.all(requests)
      setModalNota(null)
      pushToast('Calificaciones guardadas')
      await Promise.all([loadCoreData(), loadNotas()])
    } catch (error) {
      pushToast(error.message, 'warn')
    }
  }

  if (!session) {
    return (
      <div id="login-screen">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="login-logo">la35<span>Notas</span></div>
          <div className="login-sub">Sistema de Gestión de Calificaciones</div>

          <div className="field">
            <label>Ingresar como</label>
            <select value={loginRole} onChange={(event) => selectDemoRole(event.target.value)}>
              {Object.entries(ROLE_LABELS).map(([role, label]) => <option key={role} value={role}>{label}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Usuario / DNI</label>
            <input value={loginUser} onChange={(event) => setLoginUser(event.target.value)} placeholder="Ej: 31928371" autoComplete="username" />
          </div>

          <div className="field">
            <label>Contraseña</label>
            <input type="password" value={loginPass} onChange={(event) => setLoginPass(event.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </div>

          <button className="btn-primary" type="submit" disabled={loginLoading}>
            {loginLoading ? 'Conectando…' : 'Ingresar al sistema'}
          </button>

          <div className="login-hint">
            Demo escolar: <kbd>1234</kbd> como contraseña. El rol solo completa el usuario de prueba; la autenticación real la decide PostgreSQL.
          </div>
        </form>
      </div>
    )
  }

  const pageTitles = {
    dashboard: 'Panel General',
    alumnos: 'Gestión de Alumnos',
    docentes: 'Docentes y Materias',
    cursos: 'Cursos y Divisiones',
    notas: 'Carga de Calificaciones',
    consulta: isAlumno ? 'Mis Calificaciones' : 'Consulta de Calificaciones',
    notificaciones: 'Notificaciones y Alertas',
  }

  const visibleNav = [
    { id: 'dashboard', label: 'Panel General', icon: '⊞' },
    ...(!isAlumno ? [
      { id: 'alumnos', label: 'Alumnos', icon: '👥' },
      { id: 'docentes', label: 'Docentes', icon: '🏫' },
      { id: 'cursos', label: 'Cursos', icon: '📋' },
    ] : []),
    ...(canManageNotes ? [{ id: 'notas', label: 'Carga de Notas', icon: '✏️' }] : []),
    { id: 'consulta', label: 'Consulta / Boletín', icon: '📊' },
    ...(!isAlumno ? [{ id: 'notificaciones', label: 'Notificaciones', icon: '🔔' }] : []),
  ]

  return (
    <div id="app">
      <div className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">la35<span>Notas</span></div>
        <div className="sidebar-section">Principal</div>
        {visibleNav.map((item) => (
          <div key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}>
            <span className="nav-icon">{item.icon}</span>{item.label}
          </div>
        ))}
        <div className="sidebar-bottom">
          <div className="user-chip">
            <div className="user-avatar">{session.nombre?.[0]?.toUpperCase() || 'U'}</div>
            <div className="user-info">
              <div className="user-name">{session.nombre}</div>
              <div className="user-role">{ROLE_LABELS[session.rol] || session.rol}</div>
            </div>
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Abrir menú"><span/><span/><span/></button>
            <div className="topbar-title">{pageTitles[page]}</div>
          </div>
          <div className="topbar-right">
            <span className="topbar-period">Ciclo 2026</span>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Salir</button>
          </div>
        </div>

        <div className="content">
          {globalError && <div className="card" style={{ padding: 14, marginBottom: 18, borderColor: 'var(--warn)' }}><strong>Error:</strong> {globalError}</div>}
          {loading && <div className="loading-line">Sincronizando con PostgreSQL…</div>}

          {page === 'dashboard' && (
            <DashboardPage dashboard={dashboard} alumnos={alumnos} notificaciones={notificaciones} cursos={cursos} />
          )}

          {page === 'alumnos' && !isAlumno && (
            <AlumnosPage
              alumnos={filteredAlumnos}
              cursos={cursos}
              search={search}
              setSearch={setSearch}
              filterCurso={filterCurso}
              setFilterCurso={setFilterCurso}
              filterEstado={filterEstado}
              setFilterEstado={setFilterEstado}
              canManageStudents={canManageStudents}
              openNewAlumno={openNewAlumno}
              openEditAlumno={openEditAlumno}
              openNotaModal={openNotaModal}
            />
          )}

          {page === 'docentes' && <DocentesPage docentes={docentes} />}
          {page === 'cursos' && <CursosPage cursos={cursos} />}

          {page === 'notas' && canManageNotes && (
            <NotasPage
              cursos={cursos}
              materias={materias}
              notaCurso={notaCurso}
              setNotaCurso={setNotaCurso}
              notaMateria={notaMateria}
              setNotaMateria={setNotaMateria}
              notaPeriodo={notaPeriodo}
              setNotaPeriodo={setNotaPeriodo}
              noteRows={noteRows}
              openNotaModal={openNotaModal}
            />
          )}

          {page === 'consulta' && (
            <ConsultaPage isAlumno={isAlumno} misNotas={misNotas} alumnos={alumnos} />
          )}

          {page === 'notificaciones' && <NotificacionesPage notificaciones={notificaciones} />}
        </div>
      </div>

      {modalAlumno && (
        <div className="modal-overlay open" onMouseDown={(event) => event.target === event.currentTarget && setModalAlumno(null)}>
          <form className="modal" onSubmit={saveAlumno}>
            <div className="modal-title">{modalAlumno.mode === 'new' ? 'Nuevo alumno' : 'Editar alumno'}</div>
            <div className="modal-sub">Los cambios se guardan en PostgreSQL.</div>
            <div className="field"><label>DNI</label><input value={newAlumno.dni} onChange={(e) => setNewAlumno({ ...newAlumno, dni: e.target.value })} disabled={modalAlumno.mode === 'edit'} required /></div>
            <div className="field"><label>Apellido</label><input value={newAlumno.apellido} onChange={(e) => setNewAlumno({ ...newAlumno, apellido: e.target.value })} required /></div>
            <div className="field"><label>Nombre</label><input value={newAlumno.nombre} onChange={(e) => setNewAlumno({ ...newAlumno, nombre: e.target.value })} required /></div>
            <div className="field"><label>Email</label><input type="email" value={newAlumno.email} onChange={(e) => setNewAlumno({ ...newAlumno, email: e.target.value })} /></div>
            <div className="field"><label>Curso</label><select value={newAlumno.id_curso} onChange={(e) => setNewAlumno({ ...newAlumno, id_curso: e.target.value })}><option value="">Sin curso</option>{cursos.map((curso) => <option key={curso.id_curso} value={curso.id_curso}>{curso.anio}° {curso.division} — {curso.jornada || ''}</option>)}</select></div>
            <div className="field"><label>Estado</label><select value={newAlumno.estado} onChange={(e) => setNewAlumno({ ...newAlumno, estado: e.target.value })}><option>Activo</option><option>Egresado</option><option>Baja</option><option>Suspendido</option><option>Transferido</option></select></div>
            <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={() => setModalAlumno(null)}>Cancelar</button><button type="submit" className="btn btn-blue">Guardar ✓</button></div>
          </form>
        </div>
      )}

      {modalNota && (
        <div className="modal-overlay open" onMouseDown={(event) => event.target === event.currentTarget && setModalNota(null)}>
          <form className="modal" onSubmit={saveNotas}>
            <div className="modal-title">Cargar / editar nota</div>
            <div className="modal-sub">{modalNota.apellido}, {modalNota.nombre}</div>
            <div className="nota-grid">
              {EVALUACIONES.slice(0, 3).map(([key, label]) => (
                <div key={key} className="nota-field"><label>{label}</label><input type="number" min="1" max="10" step="0.01" value={notaForm[key]} onChange={(e) => setNotaForm({ ...notaForm, [key]: e.target.value })} /></div>
              ))}
            </div>
            <div className="promedio-preview"><div className="label">Promedio sugerido</div><div className="value">{suggestedAverage()}</div><div className="hint">La nota asentada sigue quedando bajo decisión del docente.</div></div>
            <div className="nota-field" style={{ marginTop: 12 }}><label>Nota final</label><input type="number" min="1" max="10" step="0.01" value={notaForm.FINAL} onChange={(e) => setNotaForm({ ...notaForm, FINAL: e.target.value })} /></div>
            <div className="nota-field" style={{ marginTop: 12 }}><label>Contenidos incompletos / observación</label><input value={notaForm.observacion} onChange={(e) => setNotaForm({ ...notaForm, observacion: e.target.value })} placeholder="Ej: Unidad 3 — Ecuaciones cuadráticas" /></div>
            <div className="modal-footer"><button type="button" className="btn btn-ghost" onClick={() => setModalNota(null)}>Cancelar</button><button type="submit" className="btn btn-blue">Guardar nota ✓</button></div>
          </form>
        </div>
      )}

      <div className="toast-container">
        {toast.map((item) => <div key={item.id} className={`toast show ${item.type === 'warn' ? 'warn-toast' : 'ok-toast'}`}>{item.message}</div>)}
      </div>
    </div>
  )
}

function DashboardPage({ dashboard, alumnos, notificaciones, cursos }) {
  return (
    <>
      <div className="stats-grid">
        <div className="stat-card blue" data-icon="👥"><div className="stat-label">Alumnos activos</div><div className="stat-value">{dashboard.alumnos_activos}</div><div className="stat-sub">{cursos.length} curso(s)</div></div>
        <div className="stat-card ok" data-icon="✅"><div className="stat-label">Aprobados</div><div className="stat-value">{dashboard.aprobados}</div><div className="stat-sub">Según promedio de notas</div></div>
        <div className="stat-card warn" data-icon="⚠️"><div className="stat-label">Contenidos incompletos</div><div className="stat-value">{dashboard.contenidos_incompletos}</div><div className="stat-sub">Observaciones registradas</div></div>
        <div className="stat-card" data-icon="📧"><div className="stat-label">Alertas</div><div className="stat-value">{notificaciones.filter((item) => item.tipo === 'Crítica').length}</div><div className="stat-sub">Últimos registros</div></div>
      </div>

      <div className="overview-grid">
        <div>
          <div className="section-header"><div className="section-title">Actividad reciente</div></div>
          <div className="card">
            {notificaciones.slice(0, 5).map((item) => (
              <div className="activity-item" key={item.id_nota}>
                <div className={`activity-dot ${item.tipo === 'Crítica' ? 'dot-warn' : 'dot-ok'}`}></div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 500 }}>{item.apellido}, {item.nombre} — {item.materia}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>{item.tipo_evaluacion} · nota {item.calificacion}</div></div>
                <span className={`badge ${item.tipo === 'Crítica' ? 'badge-warn' : 'badge-ok'}`}>{item.tipo}</span>
              </div>
            ))}
            {!notificaciones.length && <div className="empty-state">Todavía no hay actividad registrada.</div>}
          </div>
        </div>
        <div>
          <div className="section-header"><div className="section-title">Resumen</div></div>
          <div className="card" style={{ padding: 20 }}>
            <div className="summary-line"><span>Registros de alumnos</span><strong>{alumnos.length}</strong></div>
            <div className="summary-line"><span>Cursos</span><strong>{cursos.length}</strong></div>
            <div className="summary-line"><span>Notificaciones</span><strong>{notificaciones.length}</strong></div>
          </div>
        </div>
      </div>
    </>
  )
}

function AlumnosPage({ alumnos, cursos, search, setSearch, filterCurso, setFilterCurso, filterEstado, setFilterEstado, canManageStudents, openNewAlumno, openEditAlumno, openNotaModal }) {
  return (
    <>
      <div className="section-header"><div className="section-title">Gestión de Alumnos</div>{canManageStudents && <button className="btn btn-blue" onClick={openNewAlumno}>+ Nuevo alumno</button>}</div>
      <div className="card">
        <div className="filters">
          <input type="search" placeholder="Buscar por nombre o DNI…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={filterCurso} onChange={(e) => setFilterCurso(e.target.value)}><option value="">Todos los cursos</option>{cursos.map((curso) => <option key={curso.id_curso} value={curso.id_curso}>{curso.anio}° {curso.division}</option>)}</select>
          <select value={filterEstado} onChange={(e) => setFilterEstado(e.target.value)}><option value="">Todos los estados</option><option value="Activo">Activo</option><option value="Egresado">Egresado</option><option value="Baja">Baja</option></select>
        </div>
        <div className="table-wrap"><table><thead><tr><th>DNI</th><th>Apellido y nombre</th><th>Curso</th><th>Estado</th><th>Promedio</th><th>Acciones</th></tr></thead><tbody>
          {alumnos.map((alumno) => <tr key={alumno.dni}><td>{alumno.dni}</td><td><strong>{alumno.apellido}, {alumno.nombre}</strong></td><td><span className="badge badge-blue">{alumno.anio ? `${alumno.anio}° ${alumno.division}` : '—'}</span></td><td><span className={`badge ${String(alumno.estado).toLowerCase() === 'activo' ? 'badge-ok' : 'badge-warn'}`}>{alumno.estado}</span></td><td><span className={`nota-cell ${Number(alumno.promedio) >= 6 ? 'nota-ok' : 'nota-warn'}`}>{Number(alumno.promedio || 0).toFixed(1)}</span></td><td><div className="action-row"><button className="btn btn-ghost btn-sm" onClick={() => openNotaModal(alumno)}>✏️ Notas</button>{canManageStudents && <button className="btn btn-ghost btn-sm" onClick={() => openEditAlumno(alumno)}>Editar</button>}</div></td></tr>)}
          {!alumnos.length && <tr><td colSpan="6"><div className="empty-state">No hay alumnos que coincidan con el filtro.</div></td></tr>}
        </tbody></table></div>
      </div>
    </>
  )
}

function DocentesPage({ docentes }) {
  return (
    <>
      <div className="section-header"><div className="section-title">Docentes y Materias</div></div>
      <div className="card"><div className="table-wrap"><table><thead><tr><th>DNI</th><th>Nombre</th><th>Materia(s)</th><th>Cursos</th></tr></thead><tbody>{docentes.map((docente) => <tr key={docente.dni}><td>{docente.dni}</td><td>{docente.apellido}, {docente.nombre}</td><td>{docente.materias || '—'}</td><td>{docente.cursos || '—'}</td></tr>)}{!docentes.length && <tr><td colSpan="4"><div className="empty-state">No hay docentes para mostrar.</div></td></tr>}</tbody></table></div></div>
    </>
  )
}

function CursosPage({ cursos }) {
  return (
    <>
      <div className="section-header"><div className="section-title">Cursos y Divisiones</div></div>
      <div className="my-notas-grid">{cursos.map((curso) => <div className="materia-card" key={curso.id_curso}><div className="materia-header"><div><div className="materia-name">{curso.anio}° {curso.division}</div><div className="materia-prof">{curso.jornada || 'Turno no especificado'}</div></div><span className="badge badge-blue">{curso.cantidad_alumnos} alumnos</span></div><div className="materia-body"><div className="nota-row"><span className="nota-row-label">Ciclo lectivo</span><span className="nota-row-val">{curso.ciclo_lectivo || '—'}</span></div><div className="nota-row"><span className="nota-row-label">Especialidad</span><span className="nota-row-val">{curso.especialidad || '—'}</span></div></div></div>)}{!cursos.length && <div className="empty-state">No hay cursos para mostrar.</div>}</div>
    </>
  )
}

function NotasPage({ cursos, materias, notaCurso, setNotaCurso, notaMateria, setNotaMateria, notaPeriodo, setNotaPeriodo, noteRows, openNotaModal }) {
  return (
    <>
      <div className="section-header"><div className="section-title">Carga de Calificaciones</div><span className="badge badge-blue">{EVALUACIONES.find(([key]) => key === notaPeriodo)?.[1] || 'Período'}</span></div>
      <div className="card" style={{ marginBottom: 20 }}><div className="filters"><select value={notaCurso} onChange={(e) => setNotaCurso(e.target.value)}><option value="">Seleccionar curso…</option>{cursos.map((curso) => <option key={curso.id_curso} value={curso.id_curso}>{curso.anio}° {curso.division}</option>)}</select><select value={notaMateria} onChange={(e) => setNotaMateria(e.target.value)}><option value="">Seleccionar materia…</option>{materias.map((materia) => <option key={materia.codigo} value={materia.codigo}>{materia.nombre}</option>)}</select><select value={notaPeriodo} onChange={(e) => setNotaPeriodo(e.target.value)}>{EVALUACIONES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div></div>
      {!notaCurso || !notaMateria ? <div className="empty-state large">Seleccioná curso y materia para cargar notas.</div> : <div className="card"><div className="table-wrap"><table><thead><tr><th>Alumno</th><th>DNI</th><th>Bim 1</th><th>Bim 2</th><th>Promedio</th><th>Final</th><th></th></tr></thead><tbody>{noteRows.map((row) => { const b1 = row.notas.BIMESTRE_1; const b2 = row.notas.BIMESTRE_2; const avg = b1 != null && b2 != null ? ((Number(b1)+Number(b2))/2).toFixed(1) : '—'; return <tr key={row.dni}><td>{row.nombre}</td><td>{row.dni}</td><td>{b1 ?? '—'}</td><td>{b2 ?? '—'}</td><td><span className={`nota-cell ${avg !== '—' && Number(avg) >= 6 ? 'nota-ok' : 'nota-warn'}`}>{avg}</span></td><td>{row.notas.FINAL ?? '—'}</td><td><button className="btn btn-ghost btn-sm" onClick={() => openNotaModal({ dni: row.dni, ...nameParts(row.nombre) })}>✏️</button></td></tr>})}{!noteRows.length && <tr><td colSpan="7"><div className="empty-state">No hay calificaciones cargadas para esta selección.</div></td></tr>}</tbody></table></div></div>}
    </>
  )
}

function nameParts(fullName) {
  const [apellido = '', ...rest] = String(fullName).split(' ')
  return { apellido, nombre: rest.join(' ') }
}

function ConsultaPage({ isAlumno, misNotas, alumnos }) {
  const cards = isAlumno ? misNotas : alumnos.slice(0, 12).map((alumno) => ({ materia: `${alumno.apellido}, ${alumno.nombre}`, final: alumno.promedio }))
  return (
    <>
      <div className="section-header"><div className="section-title">{isAlumno ? 'Mis Calificaciones' : 'Resumen de Calificaciones'}</div></div>
      <div className="my-notas-grid">{cards.map((item, index) => <div className="materia-card" key={`${item.materia}-${index}`}><div className="materia-header"><div className="materia-name">{item.materia}</div>{isAlumno && <span className="badge badge-blue">Consulta</span>}</div><div className="materia-body">{isAlumno ? <><div className="nota-row"><span>1er Bimestre:</span><span className="nota-row-val">{item.bim1 ?? '—'}</span></div><div className="nota-row"><span>2do Bimestre:</span><span className="nota-row-val">{item.bim2 ?? '—'}</span></div><div className="nota-row"><span>1er Cuatrimestre:</span><span className="nota-row-val">{item.cuat1 ?? '—'}</span></div><div className="nota-row"><span>Final:</span><span className={`nota-row-val ${item.final != null && Number(item.final) >= 6 ? 'ok' : 'warn'}`}>{item.final ?? '—'}</span></div></> : <div className="nota-row"><span>Promedio</span><span className={`nota-row-val ${Number(item.final) >= 6 ? 'ok' : 'warn'}`}>{Number(item.final || 0).toFixed(1)}</span></div>}</div></div>)}{!cards.length && <div className="empty-state">No hay calificaciones para mostrar.</div>}</div>
    </>
  )
}

function NotificacionesPage({ notificaciones }) {
  return (
    <>
      <div className="section-header"><div className="section-title">Notificaciones y Alertas</div></div>
      <div className="notif-list">{notificaciones.map((item) => <div className="notif-item" key={item.id_nota}><div className={`notif-icon ${item.tipo === 'Crítica' ? 'warn' : 'ok'}`}>{item.tipo === 'Crítica' ? '⚠️' : '✅'}</div><div className="notif-body"><div className="notif-title">{item.apellido}, {item.nombre} — {item.materia}</div><div className="notif-desc">{item.tipo_evaluacion} · Nota {item.calificacion}</div><div className="notif-meta">{item.fecha ? new Date(item.fecha).toLocaleDateString('es-AR') : 'Sin fecha'}</div></div><span className={`badge ${item.tipo === 'Crítica' ? 'badge-warn' : 'badge-blue'}`}>{item.tipo}</span></div>)}{!notificaciones.length && <div className="empty-state">No hay notificaciones registradas.</div>}</div>
    </>
  )
}

export default App
