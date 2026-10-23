import { useEffect, useMemo, useState } from "react";
import {
  apiFetch,
  clearSession,
  getActiveCycleYear,
  getStoredUser,
  login,
  logout,
  setActiveCycleYear,
} from "./services/api";

const ROLE_LABELS = {
  admin: "Administrador",
  profesor: "Docente",
  alumno: "Alumno",
  preceptor: "Preceptor",
};

const ESTADOS_ALUMNO = [
  "Activo",
  "Egresado",
  "Baja",
  "Suspendido",
  "Transferido",
  "No corresponde",
];
const PERIODOS_NOTA_INDIVIDUAL = [
  ["BIMESTRE_1", "1er bimestre"],
  ["BIMESTRE_2", "2do bimestre"],
  ["BIMESTRE_3", "3er bimestre"],
  ["BIMESTRE_4", "4to bimestre"],
  ["DICIEMBRE", "Diciembre"],
  ["FEBRERO", "Febrero"],
];
const BULLETIN_PERIODS = [
  ["BIMESTRE_1", "1° bim."],
  ["BIMESTRE_2", "2° bim."],
  ["CUATRIMESTRE_1", "1° cuat."],
  ["BIMESTRE_3", "3° bim."],
  ["BIMESTRE_4", "4° bim."],
  ["CUATRIMESTRE_2", "2° cuat."],
  ["FINAL", "Final"],
  ["DICIEMBRE", "Dic"],
  ["FEBRERO", "Feb"],
];

function App() {
  const [session, setSession] = useState(getStoredUser());
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const [page, setPage] = useState(() => {
    const role = getStoredUser()?.rol;
    return role === "profesor"
      ? "notas"
      : role === "preceptor"
        ? "alumnos"
        : role === "alumno"
          ? "consulta"
          : "dashboard";
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState("");

  const [alumnos, setAlumnos] = useState([]);
  const [docentes, setDocentes] = useState([]);
  const [cursos, setCursos] = useState([]);
  const [turnos, setTurnos] = useState([]);
  const [ciclosLectivos, setCiclosLectivos] = useState([]);
  const [selectedCycleYear, setSelectedCycleYear] =
    useState(getActiveCycleYear);
  const [materias, setMaterias] = useState([]);
  const [catalogoMaterias, setCatalogoMaterias] = useState([]);
  const [asignacionesDocente, setAsignacionesDocente] = useState([]);
  const [notas, setNotas] = useState([]);
  const [dashboard, setDashboard] = useState({
    alumnos_activos: 0,
    calificaciones_cargadas: 0,
  });
  const [notificaciones, setNotificaciones] = useState([]);
  const [misBoletines, setMisBoletines] = useState([]);

  const [search, setSearch] = useState("");
  const [filterCurso, setFilterCurso] = useState("");
  const [filterEstado, setFilterEstado] = useState("Activo");
  const [notaCurso, setNotaCurso] = useState("");
  const [notaMateria, setNotaMateria] = useState("");

  const [modalAlumno, setModalAlumno] = useState(null);
  const [modalDocente, setModalDocente] = useState(null);
  const [docenteForm, setDocenteForm] = useState({
    dni: "",
    nombre: "",
    apellido: "",
    email: "",
    telefono: "",
    estado: "Activo",
    asignaciones: [],
  });
  const [modalCurso, setModalCurso] = useState(null);
  const [modalMateria, setModalMateria] = useState(null);
  const [modalNota, setModalNota] = useState(null);
  const [modalNotaIndividual, setModalNotaIndividual] = useState(null);
  const [notasIndividuales, setNotasIndividuales] = useState([]);
  const [notasIndividualesLoading, setNotasIndividualesLoading] =
    useState(false);
  const [notaIndividualError, setNotaIndividualError] = useState("");
  const [notaIndividualForm, setNotaIndividualForm] = useState({
    id_nota_individual: null,
    tipo_evaluacion: "BIMESTRE_1",
    tema: "",
    estado: "Entregado",
    calificacion: "1",
    adeuda: null,
    notificar_alumno: true,
  });
  const [nuevoCicloAnio, setNuevoCicloAnio] = useState("");
  const [nuevoCicloCopiarDesde, setNuevoCicloCopiarDesde] = useState("");
  const [cursoForm, setCursoForm] = useState({
    anio: "1",
    especialidad: "",
    turno_id: "",
    materias: [],
  });
  const [materiaForm, setMateriaForm] = useState({ codigo: "", nombre: "" });
  const [newAlumno, setNewAlumno] = useState({
    dni: "",
    nombre: "",
    apellido: "",
    email: "",
    id_curso: "",
    estado: "Activo",
  });

  const [notaForm, setNotaForm] = useState({
    BIMESTRE_1: "",
    BIMESTRE_2: "",
    CUATRIMESTRE_1: "",
    BIMESTRE_3: "",
    BIMESTRE_4: "",
    CUATRIMESTRE_2: "",
    FINAL: "",
    DICIEMBRE: "",
    FEBRERO: "",
  });
  const [notificarNotaGeneral, setNotificarNotaGeneral] = useState(true);

  const isAlumno = session?.rol === "alumno";
  const canManageStudents =
    session?.rol === "admin" || session?.rol === "preceptor";
  const canManageTeachers =
    session?.rol === "admin" || session?.rol === "preceptor";
  const canManageCourses = session?.rol === "admin";
  const canManageNotes = ["admin", "profesor", "preceptor"].includes(
    session?.rol,
  );
  const isViewingHistoricalCycle =
    session?.rol === "admin" &&
    ciclosLectivos.length > 0 &&
    Number(selectedCycleYear) !== Number(ciclosLectivos[0].anio);

  function pushToast(message, type = "ok") {
    const id = Date.now() + Math.random();
    setToast((items) => [...items, { id, message, type }]);
    setTimeout(
      () => setToast((items) => items.filter((item) => item.id !== id)),
      3200,
    );
  }

  async function loadCoreData() {
    if (!session) return;
    setLoading(true);
    setGlobalError("");
    try {
      const ciclosData = await apiFetch("/ciclos-lectivos");
      const latestCycleYear = ciclosData[0]?.anio || null;
      const cycleYear =
        session.rol === "admin" &&
        ciclosData.some(
          (ciclo) => Number(ciclo.anio) === Number(selectedCycleYear),
        )
          ? selectedCycleYear
          : latestCycleYear;
      setActiveCycleYear(cycleYear);
      if (Number(selectedCycleYear) !== Number(cycleYear))
        setSelectedCycleYear(cycleYear);
      setCiclosLectivos(ciclosData);

      const [
        dash,
        alumnosData,
        cursosData,
        turnosData,
        materiasData,
        catalogoMateriasData,
        asignacionesData,
      ] = await Promise.all([
        apiFetch("/dashboard"),
        apiFetch("/alumnos"),
        apiFetch("/cursos"),
        session.rol === "admin" ? apiFetch("/turnos") : Promise.resolve([]),
        apiFetch("/materias"),
        session.rol === "admin"
          ? apiFetch("/materias/catalogo")
          : Promise.resolve([]),
        session.rol === "profesor"
          ? apiFetch("/docente-asignaciones")
          : Promise.resolve([]),
      ]);
      setDashboard(dash);
      setAlumnos(alumnosData);
      setCursos(cursosData);
      setTurnos(turnosData);
      setMaterias(materiasData);
      setCatalogoMaterias(catalogoMateriasData);
      setAsignacionesDocente(asignacionesData);

      if (!isAlumno) {
        const [docentesData, notifData] = await Promise.all([
          apiFetch("/docentes"),
          apiFetch("/notificaciones"),
        ]);
        setDocentes(docentesData);
        setNotificaciones(notifData);
      } else {
        const [misBoletinesData, notifData] = await Promise.all([
          apiFetch("/mis-boletines"),
          apiFetch("/notificaciones"),
        ]);
        setMisBoletines(misBoletinesData);
        setNotificaciones(notifData);
      }
    } catch (error) {
      setGlobalError(error.message);
      if (/No autenticado/i.test(error.message)) {
        clearSession();
        setSession(null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session) loadCoreData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id_usuario, session?.rol, selectedCycleYear]);

  useEffect(() => {
    setActiveCycleYear(selectedCycleYear);
  }, [selectedCycleYear]);

  async function handleLogin(event) {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError("");
    try {
      const user = await login(loginUser.trim(), loginPass);
      setSession(user);
      setPage(
        user.rol === "alumno"
          ? "consulta"
          : user.rol === "profesor"
            ? "notas"
            : user.rol === "preceptor"
              ? "alumnos"
              : "dashboard",
      );
      pushToast(`Sesión iniciada como ${ROLE_LABELS[user.rol] || user.rol}`);
    } catch (error) {
      setLoginError(error.message);
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      setSession(null);
      setPage("dashboard");
    }
  }

  function navigate(nextPage) {
    if (session?.rol === "profesor" && nextPage !== "notas") return;
    if (
      session?.rol === "preceptor" &&
      ["dashboard", "cursos", "notas", "notificaciones"].includes(nextPage)
    )
      return;
    if (nextPage === "alumnos" && isAlumno) return;
    if (nextPage === "notas" && !canManageNotes) return;
    if (nextPage === "materias" && session?.rol !== "admin") return;
    if (nextPage === "ciclos-lectivos" && session?.rol !== "admin") return;
    if (
      ["preceptores", "administradores"].includes(nextPage) &&
      session?.rol !== "admin"
    )
      return;
    setPage(nextPage);
    setSidebarOpen(false);
  }

  const filteredAlumnos = useMemo(() => {
    const term = search.trim().toLowerCase();
    return alumnos.filter((alumno) => {
      const nombreCompleto = `${alumno.apellido || ""} ${alumno.nombre || ""}`
        .trim()
        .toLowerCase();
      const matchSearch =
        !term ||
        nombreCompleto.includes(term) ||
        String(alumno.dni).includes(term);
      const matchCurso =
        !filterCurso || String(alumno.id_curso) === String(filterCurso);
      const matchEstado =
        !filterEstado ||
        String(alumno.estado).toLowerCase() === filterEstado.toLowerCase();
      return matchSearch && matchCurso && matchEstado;
    });
  }, [alumnos, search, filterCurso, filterEstado]);

  const noteRows = useMemo(() => {
    const cursoAlumnos = alumnos.filter(
      (alumno) => String(alumno.id_curso) === String(notaCurso),
    );
    return cursoAlumnos.map((alumno) => {
      const studentNotes = notas.filter(
        (nota) =>
          nota.dni === alumno.dni && nota.codigo_materia === notaMateria,
      );
      const grades = Object.fromEntries(
        studentNotes.map((nota) => [nota.tipo_evaluacion, nota.calificacion]),
      );
      return {
        ...alumno,
        notas: grades,
      };
    });
  }, [alumnos, notas, notaCurso, notaMateria]);

  const cursosNotas =
    session?.rol === "profesor"
      ? cursos.filter((curso) =>
          asignacionesDocente.some(
            (asignacion) =>
              String(asignacion.id_curso) === String(curso.id_curso),
          ),
        )
      : cursos;

  const materiasNotas =
    session?.rol === "profesor"
      ? materias.filter((materia) =>
          asignacionesDocente.some(
            (asignacion) =>
              String(asignacion.id_curso) === String(notaCurso) &&
              asignacion.codigo_materia === materia.codigo,
          ),
        )
      : materias;

  async function loadNotas() {
    if (!notaCurso) {
      setNotas([]);
      return;
    }
    try {
      const data = await apiFetch(
        `/notas?curso=${encodeURIComponent(notaCurso)}`,
      );
      setNotas(data);
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  useEffect(() => {
    if (page === "notas" && notaCurso) loadNotas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, notaCurso, selectedCycleYear]);

  function selectCycle(year) {
    if (session?.rol !== "admin") return;
    const nextYear = Number(year) || null;
    setActiveCycleYear(nextYear);
    setSelectedCycleYear(nextYear);
    setNotaCurso("");
    setNotaMateria("");
    setNotas([]);
    setFilterCurso("");
    setModalAlumno(null);
    setModalDocente(null);
    setModalCurso(null);
    setModalMateria(null);
    setModalNota(null);
    setModalNotaIndividual(null);
  }

  function resetNewAlumno() {
    setNewAlumno({
      dni: "",
      nombre: "",
      apellido: "",
      email: "",
      id_curso: cursos[0]?.id_curso || "",
      estado: "Activo",
    });
  }

  function openNewAlumno() {
    resetNewAlumno();
    setModalAlumno({ mode: "new" });
  }

  function openEditAlumno(alumno) {
    setNewAlumno({
      dni: alumno.dni,
      nombre: alumno.nombre || "",
      apellido: alumno.apellido || "",
      email: alumno.email || "",
      id_curso: alumno.estado === "Activo" ? alumno.id_curso || "" : "",
      estado: alumno.estado || "Activo",
    });
    setModalAlumno({ mode: "edit", alumno });
  }

  async function saveAlumno(event) {
    event.preventDefault();
    try {
      const body = {
        dni: newAlumno.dni.trim(),
        nombre: newAlumno.nombre.trim(),
        apellido: newAlumno.apellido.trim(),
        email: newAlumno.email.trim() || null,
        id_curso:
          newAlumno.estado === "Activo" ? newAlumno.id_curso || null : null,
        estado: newAlumno.estado,
      };
      if (modalAlumno.mode === "new") {
        await apiFetch("/alumnos", {
          method: "POST",
          body: JSON.stringify(body),
        });
        pushToast("Alumno guardado");
      } else {
        await apiFetch(`/alumnos/${encodeURIComponent(newAlumno.dni)}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        pushToast("Alumno actualizado");
      }
      setModalAlumno(null);
      await loadCoreData();
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  function openNewDocente() {
    setDocenteForm({
      dni: "",
      nombre: "",
      apellido: "",
      email: "",
      telefono: "",
      estado: "Activo",
      asignaciones: [],
    });
    setModalDocente({ mode: "new" });
  }

  function openEditDocente(docente) {
    setDocenteForm({
      dni: docente.dni,
      nombre: docente.nombre || "",
      apellido: docente.apellido || "",
      email: docente.email || "",
      telefono: docente.telefono || "",
      estado: docente.estado || "Activo",
      asignaciones: (docente.asignaciones || []).map((assignment) => ({
        codigo_materia: assignment.codigo_materia,
        cursos: assignment.cursos.map((curso) => String(curso.id_curso)),
      })),
    });
    setModalDocente({ mode: "edit", docente });
  }

  function addDocenteAssignment() {
    const usedSubjects = new Set(
      docenteForm.asignaciones.map((item) => item.codigo_materia),
    );
    const availableSubject = materias.find(
      (materia) => !usedSubjects.has(materia.codigo),
    );
    if (!availableSubject) {
      pushToast("Ya se agregaron todas las materias disponibles", "warn");
      return;
    }
    setDocenteForm((current) => ({
      ...current,
      asignaciones: [
        ...current.asignaciones,
        { codigo_materia: availableSubject.codigo, cursos: [] },
      ],
    }));
  }

  function updateDocenteAssignment(index, changes) {
    setDocenteForm((current) => ({
      ...current,
      asignaciones: current.asignaciones.map((assignment, assignmentIndex) =>
        assignmentIndex === index ? { ...assignment, ...changes } : assignment,
      ),
    }));
  }

  async function saveDocente(event) {
    event.preventDefault();
    const isNew = modalDocente.mode === "new";
    try {
      await apiFetch(
        isNew
          ? "/docentes"
          : `/docentes/${encodeURIComponent(modalDocente.docente.dni)}`,
        {
          method: isNew ? "POST" : "PUT",
          body: JSON.stringify({
            ...docenteForm,
            dni: docenteForm.dni.trim(),
            nombre: docenteForm.nombre.trim(),
            apellido: docenteForm.apellido.trim(),
            email: docenteForm.email.trim() || null,
            telefono: docenteForm.telefono.trim() || null,
          }),
        },
      );
      setModalDocente(null);
      pushToast(isNew ? "Docente agregado" : "Docente actualizado");
      await loadCoreData();
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  async function deleteDocente(docente) {
    if (
      !window.confirm(
        `¿Eliminar a ${docente.apellido}, ${docente.nombre}? Solo se puede eliminar si no tiene datos asignados.`,
      )
    )
      return;
    try {
      await apiFetch(`/docentes/${encodeURIComponent(docente.dni)}`, {
        method: "DELETE",
      });
      setModalDocente(null);
      pushToast("Docente eliminado");
      await loadCoreData();
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  function openNewCurso() {
    setCursoForm({
      anio: "1",
      especialidad: "",
      turno_id: "",
      materias: [],
    });
    setModalCurso({ mode: "new" });
  }

  function openEditCurso(curso) {
    setCursoForm({
      anio: String(curso.anio),
      especialidad: curso.especialidad,
      turno_id: curso.turno_id ? String(curso.turno_id) : "",
      materias: (curso.materias || []).map((materia) => materia.codigo),
    });
    setModalCurso({ mode: "edit", curso });
  }

  async function saveCurso(event) {
    event.preventDefault();
    const body = {
      anio: Number(cursoForm.anio),
      especialidad: Number(cursoForm.anio) <= 2 ? null : cursoForm.especialidad,
      turno_id: cursoForm.turno_id || null,
      materias: cursoForm.materias,
    };

    try {
      const isNew = modalCurso.mode === "new";
      await apiFetch(
        isNew ? "/cursos" : `/cursos/${modalCurso.curso.id_curso}`,
        {
          method: isNew ? "POST" : "PUT",
          body: JSON.stringify(body),
        },
      );
      setModalCurso(null);
      pushToast(isNew ? "Curso creado" : "Curso actualizado");
      await loadCoreData();
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  async function deleteCurso(curso) {
    if (
      !window.confirm(
        `¿Eliminar ${curso.anio}° ${curso.division}°${curso.especialidad ? ` — ${curso.especialidad}` : ""}? No se puede deshacer. Los cursos con alumnos o notas asociadas no se pueden eliminar.`,
      )
    )
      return;
    try {
      await apiFetch(`/cursos/${curso.id_curso}`, { method: "DELETE" });
      setModalCurso(null);
      pushToast("Curso eliminado");
      await loadCoreData();
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  function openNewMateria() {
    setMateriaForm({ codigo: "", nombre: "" });
    setModalMateria({ mode: "new" });
  }

  function openEditMateria(materia) {
    setMateriaForm({
      codigo: materia.codigo,
      nombre: materia.nombre || "",
    });
    setModalMateria({ mode: "edit", materia });
  }

  async function saveMateria(event) {
    event.preventDefault();
    const isNew = modalMateria.mode === "new";
    const body = {
      nombre: materiaForm.nombre.trim(),
    };
    if (isNew) body.codigo = materiaForm.codigo.trim().toUpperCase();

    try {
      const saved = await apiFetch(
        isNew
          ? "/materias"
          : `/materias/${encodeURIComponent(modalMateria.materia.codigo)}`,
        { method: isNew ? "POST" : "PUT", body: JSON.stringify(body) },
      );
      setModalMateria(null);
      pushToast(
        isNew && saved.reutilizada
          ? `Se reutilizó ${saved.nombre} en todos los ciclos`
          : isNew
            ? "Materia creada"
            : "Materia actualizada",
      );
      await loadCoreData();
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  async function assignMateria(codigo) {
    try {
      await apiFetch(`/materias/${encodeURIComponent(codigo)}/asignacion`, {
        method: "POST",
      });
      pushToast("Materia asignada al ciclo lectivo");
      await loadCoreData();
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  async function deleteMateria(materia) {
    if (
      !window.confirm(
        `¿Quitar ${materia.nombre} del ciclo actual? No se puede quitar si tiene cursos, profesores o notas asignadas. La materia seguirá disponible en el catálogo global.`,
      )
    )
      return;
    try {
      await apiFetch(`/materias/${encodeURIComponent(materia.codigo)}`, {
        method: "DELETE",
      });
      setModalMateria(null);
      pushToast("Materia quitada del ciclo lectivo");
      await loadCoreData();
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  async function createCicloLectivo(event) {
    event.preventDefault();
    try {
      const ciclo = await apiFetch("/ciclos-lectivos", {
        method: "POST",
        body: JSON.stringify({
          anio: Number(nuevoCicloAnio),
          copiar_desde: nuevoCicloCopiarDesde
            ? Number(nuevoCicloCopiarDesde)
            : null,
        }),
      });
      setNuevoCicloAnio("");
      selectCycle(ciclo.anio);
      pushToast(
        nuevoCicloCopiarDesde
          ? "Ciclo lectivo creado con los datos copiados"
          : "Ciclo lectivo creado",
      );
      setNuevoCicloCopiarDesde("");
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  async function deleteCicloLectivo(ciclo) {
    if (
      !window.confirm(
        `¿Eliminar el ciclo lectivo ${ciclo.anio}? Solo se puede eliminar si no tiene datos asignados.`,
      )
    )
      return;
    try {
      await apiFetch(`/ciclos-lectivos/${ciclo.id_ciclo_lectivo}`, {
        method: "DELETE",
      });
      pushToast("Ciclo lectivo eliminado");
      if (Number(selectedCycleYear) === Number(ciclo.anio)) {
        const nextCycleYear =
          ciclosLectivos.find(
            (item) => item.id_ciclo_lectivo !== ciclo.id_ciclo_lectivo,
          )?.anio || null;
        setSelectedCycleYear(nextCycleYear);
        setActiveCycleYear(nextCycleYear);
      } else {
        await loadCoreData();
      }
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  function openNotaModal(alumno) {
    const existing = notas.filter(
      (row) => row.dni === alumno.dni && row.codigo_materia === notaMateria,
    );
    const calificaciones = Object.fromEntries(
      existing.map((row) => [row.tipo_evaluacion, row.calificacion]),
    );
    setNotaForm({
      BIMESTRE_1: calificaciones.BIMESTRE_1 ?? "",
      BIMESTRE_2: calificaciones.BIMESTRE_2 ?? "",
      CUATRIMESTRE_1: calificaciones.CUATRIMESTRE_1 ?? "",
      BIMESTRE_3: calificaciones.BIMESTRE_3 ?? "",
      BIMESTRE_4: calificaciones.BIMESTRE_4 ?? "",
      CUATRIMESTRE_2: calificaciones.CUATRIMESTRE_2 ?? "",
      FINAL: calificaciones.FINAL ?? "",
      DICIEMBRE: calificaciones.DICIEMBRE ?? "",
      FEBRERO: calificaciones.FEBRERO ?? "",
    });
    setNotificarNotaGeneral(true);
    setModalNota({ ...alumno, codigo_materia: notaMateria });
  }

  async function openIndividualNotesModal(alumno) {
    setModalNotaIndividual({ ...alumno, codigo_materia: notaMateria });
    setNotaIndividualForm({
      id_nota_individual: null,
      tipo_evaluacion: "BIMESTRE_1",
      tema: "",
      estado: "Entregado",
      calificacion: "1",
      adeuda: null,
      notificar_alumno: true,
    });
    setNotaIndividualError("");
    setNotasIndividuales([]);
    setNotasIndividualesLoading(true);
    try {
      const params = new URLSearchParams({
        curso: String(alumno.id_curso),
        materia: notaMateria,
        dni: alumno.dni,
      });
      setNotasIndividuales(await apiFetch(`/notas-individuales?${params}`));
      setNotaIndividualError("");
    } catch (error) {
      setNotaIndividualError(error.message);
      pushToast(error.message, "warn");
    } finally {
      setNotasIndividualesLoading(false);
    }
  }

  async function refreshIndividualNotes() {
    if (!modalNotaIndividual) return;
    const params = new URLSearchParams({
      curso: String(modalNotaIndividual.id_curso),
      materia: modalNotaIndividual.codigo_materia,
      dni: modalNotaIndividual.dni,
    });
    setNotasIndividualesLoading(true);
    try {
      setNotasIndividuales(await apiFetch(`/notas-individuales?${params}`));
      setNotaIndividualError("");
    } finally {
      setNotasIndividualesLoading(false);
    }
  }

  async function saveIndividualNote(event) {
    event.preventDefault();
    if (!modalNotaIndividual) return;
    try {
      const { id_nota_individual, ...form } = notaIndividualForm;
      const body = {
        ...form,
        dni_alumno: modalNotaIndividual.dni,
        id_curso: modalNotaIndividual.id_curso,
        codigo_materia: modalNotaIndividual.codigo_materia,
        calificacion: Number(form.calificacion),
        adeuda: Number(form.calificacion) < 6 ? form.adeuda : null,
      };
      await apiFetch(
        id_nota_individual
          ? `/notas-individuales/${id_nota_individual}`
          : "/notas-individuales",
        {
          method: id_nota_individual ? "PUT" : "POST",
          body: JSON.stringify(body),
        },
      );
      await refreshIndividualNotes();
      setNotaIndividualForm((current) => ({
        ...current,
        id_nota_individual: null,
        tema: "",
        estado: "Entregado",
        calificacion: "1",
        adeuda: null,
        notificar_alumno: true,
      }));
      pushToast(
        id_nota_individual ? "Evaluación actualizada" : "Evaluación agregada",
      );
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  function editIndividualNote(nota) {
    setNotaIndividualForm({
      id_nota_individual: nota.id_nota_individual,
      tipo_evaluacion: nota.tipo_evaluacion,
      tema: nota.tema,
      estado: nota.estado,
      calificacion: String(nota.calificacion),
      adeuda: nota.adeuda ?? null,
      notificar_alumno: true,
    });
  }

  async function deleteIndividualNote(nota) {
    if (!window.confirm(`¿Eliminar la evaluación "${nota.tema}"?`)) return;
    try {
      await apiFetch(`/notas-individuales/${nota.id_nota_individual}`, {
        method: "DELETE",
        body: JSON.stringify({
          dni_alumno: modalNotaIndividual.dni,
          id_curso: modalNotaIndividual.id_curso,
          codigo_materia: modalNotaIndividual.codigo_materia,
        }),
      });
      await refreshIndividualNotes();
      if (notaIndividualForm.id_nota_individual === nota.id_nota_individual) {
        setNotaIndividualForm((current) => ({
          ...current,
          id_nota_individual: null,
          tema: "",
        }));
      }
      pushToast("Evaluación eliminada");
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  function calculateAverage(first, second) {
    if (
      first === "" ||
      first == null ||
      second === "" ||
      second == null ||
      !Number.isFinite(Number(first)) ||
      !Number.isFinite(Number(second))
    ) {
      return "—";
    }

    return ((Number(first) + Number(second)) / 2).toFixed(2);
  }

  function suggestedAverages() {
    const cuatrimestre1 = calculateAverage(
      notaForm.BIMESTRE_1,
      notaForm.BIMESTRE_2,
    );

    const cuatrimestre2 = calculateAverage(
      notaForm.BIMESTRE_3,
      notaForm.BIMESTRE_4,
    );

    const final = calculateAverage(
      notaForm.CUATRIMESTRE_1,
      notaForm.CUATRIMESTRE_2,
    );

    return { cuatrimestre1, cuatrimestre2, final };
  }

  function isFailedGrade(value) {
    return (
      value !== "" &&
      value != null &&
      Number.isFinite(Number(value)) &&
      Number(value) < 6
    );
  }

  async function saveNotas(event) {
    event.preventDefault();
    if (!modalNota?.codigo_materia) {
      pushToast("Seleccioná una materia en el filtro", "warn");
      return;
    }
    try {
      const gradesToSave = { ...notaForm };
      if (!isFailedGrade(gradesToSave.FINAL)) {
        gradesToSave.DICIEMBRE = "";
        gradesToSave.FEBRERO = "";
      } else if (!isFailedGrade(gradesToSave.DICIEMBRE)) {
        gradesToSave.FEBRERO = "";
      }

      const existingGrades = notas.filter(
        (row) =>
          row.dni === modalNota.dni &&
          row.codigo_materia === modalNota.codigo_materia,
      );
      const existingTypes = new Set(
        existingGrades.map((row) => row.tipo_evaluacion),
      );
      const existingGradesByType = new Map(
        existingGrades.map((row) => [row.tipo_evaluacion, row]),
      );
      const gradeEntries = Object.entries(gradesToSave);
      const deleteCount = gradeEntries.filter(
        ([tipo_evaluacion, value]) =>
          value === "" && existingTypes.has(tipo_evaluacion),
      ).length;
      if (
        deleteCount &&
        !window.confirm(`¿Eliminar ${deleteCount} calificación(es) vacía(s)?`)
      )
        return;

      const requests = gradeEntries.flatMap(([tipo_evaluacion, value]) => {
        if (value !== "") {
          const previousGrade =
            existingGradesByType.get(tipo_evaluacion)?.calificacion;
          if (previousGrade != null && Number(previousGrade) === Number(value))
            return [];
          return [
            apiFetch("/notas", {
              method: "POST",
              body: JSON.stringify({
                dni_alumno: modalNota.dni,
                codigo_materia: modalNota.codigo_materia,
                tipo_evaluacion,
                calificacion: Number(value),
                notificar_alumno: notificarNotaGeneral,
              }),
            }),
          ];
        }
        if (existingTypes.has(tipo_evaluacion)) {
          return [
            apiFetch("/notas", {
              method: "DELETE",
              body: JSON.stringify({
                dni_alumno: modalNota.dni,
                codigo_materia: modalNota.codigo_materia,
                tipo_evaluacion,
              }),
            }),
          ];
        }
        return [];
      });

      if (!requests.length) {
        pushToast("No hay cambios en las calificaciones", "warn");
        return;
      }

      await Promise.all(requests);
      setModalNota(null);
      pushToast(
        deleteCount
          ? "Calificaciones actualizadas"
          : "Calificaciones guardadas",
      );
      await Promise.all([loadCoreData(), loadNotas()]);
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  if (!session) {
    return (
      <div id="login-screen">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="login-logo">
            la35<span>Notas</span>
          </div>
          <div className="login-sub">Sistema de Gestión de Calificaciones</div>

          <div className="field">
            <label>DNI</label>
            <input
              value={loginUser}
              onChange={(event) => {
                setLoginUser(event.target.value.replace(/\D/g, ""));
                setLoginError("");
              }}
              placeholder="Ingresá tu DNI"
              inputMode="numeric"
              autoComplete="username"
              required
            />
          </div>

          <div className="field">
            <label>Contraseña</label>
            <input
              type="password"
              value={loginPass}
              onChange={(event) => {
                setLoginPass(event.target.value);
                setLoginError("");
              }}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {loginError && (
            <div className="login-error" role="alert">
              {loginError}
            </div>
          )}

          <button className="btn-primary" type="submit" disabled={loginLoading}>
            {loginLoading ? "Conectando…" : "Ingresar al sistema"}
          </button>

          <div className="login-hint">
            Ingresá tu DNI y la contraseña de tu cuenta. Si no la conocés,
            contactá a administración.
          </div>
        </form>
      </div>
    );
  }

  const pageTitles = {
    dashboard: "Panel General",
    alumnos: "Alumnos",
    docentes: "Docentes",
    cursos: "Cursos y Divisiones",
    materias: "Gestión de Materias",
    "ciclos-lectivos": "Ciclos Lectivos",
    notas: "Carga de Calificaciones",
    consulta: "Boletines",
    notificaciones: "Notificaciones y Alertas",
    preceptores: "Preceptores",
    administradores: "Administradores",
  };

  const visibleNav =
    session?.rol === "profesor"
      ? [{ id: "notas", label: "Carga de Notas", icon: "✏️" }]
      : [
          ...(session?.rol === "admin"
            ? [
                { id: "dashboard", label: "Panel General", icon: "⊞" },
                { type: "spacer", id: "spacer-primary" },
              ]
            : []),
          ...(!isAlumno
            ? [{ id: "alumnos", label: "Alumnos", icon: "👥" }]
            : []),
          { id: "consulta", label: "Boletines", icon: "📊" },
          ...(!isAlumno
            ? [{ id: "docentes", label: "Docentes", icon: "🏫" }]
            : []),
          ...(canManageNotes && session?.rol !== "preceptor"
            ? [{ id: "notas", label: "Carga de Notas", icon: "✏️" }]
            : []),
          ...(session?.rol !== "preceptor" &&
          session?.rol !== "profesor" &&
          session?.rol !== "admin"
            ? [{ id: "notificaciones", label: "Notificaciones", icon: "🔔" }]
            : []),
          ...(session?.rol === "admin"
            ? [
                { id: "preceptores", label: "Preceptores", icon: "📚" },
                { id: "administradores", label: "Administradores", icon: "🛡️" },
                { type: "spacer", id: "spacer-admin" },
                { id: "ciclos-lectivos", label: "Ciclos Lectivos", icon: "🗓️" },
                { id: "cursos", label: "Cursos", icon: "📋" },
                { id: "materias", label: "Materias", icon: "📚" },
              ]
            : []),
        ];

  return (
    <div id="app">
      <div
        className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-logo">
          la35<span>Notas</span>
        </div>
        {visibleNav.map((item) =>
          item.type === "spacer" ? (
            <div
              key={item.id}
              className="sidebar-nav-spacer"
              aria-hidden="true"
            />
          ) : (
            <div
              key={item.id}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              onClick={() => navigate(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </div>
          ),
        )}
        <div className="sidebar-bottom">
          <div className="user-chip">
            <div className="user-avatar">
              {session.nombre?.[0]?.toUpperCase() || "U"}
            </div>
            <div className="user-info">
              <div className="user-name">{session.nombre}</div>
              <div className="user-role">
                {ROLE_LABELS[session.rol] || session.rol}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              className="hamburger"
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir menú"
            >
              <span />
              <span />
              <span />
            </button>
            <div className="topbar-title">{pageTitles[page]}</div>
          </div>
          <div className="topbar-right">
            {session?.rol === "admin" ? (
              <label
                className={`topbar-period ${isViewingHistoricalCycle ? "historical" : ""}`}
              >
                <span>Ciclo</span>
                <select
                  aria-label="Seleccionar ciclo lectivo"
                  value={selectedCycleYear || ""}
                  onChange={(event) => selectCycle(event.target.value)}
                  disabled={!ciclosLectivos.length}
                >
                  {!ciclosLectivos.length && <option value="">—</option>}
                  {ciclosLectivos.map((ciclo) => (
                    <option key={ciclo.id_ciclo_lectivo} value={ciclo.anio}>
                      {ciclo.anio}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="topbar-period">
                <span>Ciclo</span>
                <strong>{selectedCycleYear || "—"}</strong>
              </div>
            )}
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
              Salir
            </button>
          </div>
        </div>

        <div className="content">
          {globalError && (
            <div
              className="card"
              style={{
                padding: 14,
                marginBottom: 18,
                borderColor: "var(--warn)",
              }}
            >
              <strong>Error:</strong> {globalError}
            </div>
          )}
          {loading && (
            <div className="loading-line">Sincronizando con PostgreSQL…</div>
          )}

          {page === "dashboard" && ["admin"].includes(session?.rol) && (
            <DashboardPage
              dashboard={dashboard}
              alumnos={alumnos}
              notificaciones={notificaciones}
              cursos={cursos}
            />
          )}

          {page === "alumnos" && !isAlumno && (
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
            />
          )}

          {page === "docentes" && (
            <DocentesPage
              docentes={docentes}
              cursos={cursos}
              materias={materias}
              canManageTeachers={canManageTeachers}
              openNewDocente={openNewDocente}
              openEditDocente={openEditDocente}
            />
          )}
          {page === "cursos" && session?.rol !== "preceptor" && (
            <CursosPage
              cursos={cursos}
              materias={materias}
              alumnos={alumnos}
              canManageCourses={canManageCourses}
              openNewCurso={openNewCurso}
              openEditCurso={openEditCurso}
            />
          )}
          {page === "materias" && session?.rol === "admin" && (
            <MateriasPage
              materias={materias}
              catalogoMaterias={catalogoMaterias}
              openNewMateria={openNewMateria}
              openEditMateria={openEditMateria}
              onAssignMateria={assignMateria}
            />
          )}
          {page === "preceptores" && session?.rol === "admin" && (
            <PersonalAdminPage
              key="preceptores"
              resource="preceptores"
              title="Preceptores"
              currentAdminDni={session?.dni_administrador}
              pushToast={pushToast}
            />
          )}
          {page === "administradores" && session?.rol === "admin" && (
            <PersonalAdminPage
              key="administradores"
              resource="administradores"
              title="Administradores"
              includeCargo
              currentAdminDni={session?.dni_administrador}
              pushToast={pushToast}
            />
          )}
          {page === "ciclos-lectivos" && session?.rol === "admin" && (
            <CiclosLectivosPage
              ciclos={ciclosLectivos}
              nuevoAnio={nuevoCicloAnio}
              setNuevoAnio={setNuevoCicloAnio}
              copiarDesde={nuevoCicloCopiarDesde}
              setCopiarDesde={setNuevoCicloCopiarDesde}
              onCreate={createCicloLectivo}
              onDelete={deleteCicloLectivo}
            />
          )}

          {page === "notas" &&
            canManageNotes &&
            session?.rol !== "preceptor" && (
              <NotasPage
                cursos={cursosNotas}
                materias={materiasNotas}
                alumnos={alumnos}
                notaCurso={notaCurso}
                setNotaCurso={setNotaCurso}
                notaMateria={notaMateria}
                setNotaMateria={setNotaMateria}
                noteRows={noteRows}
                openNotaModal={openNotaModal}
                openIndividualNotesModal={openIndividualNotesModal}
              />
            )}

          {page === "consulta" && (
            <ConsultaPage
              isAlumno={isAlumno}
              boletines={misBoletines}
              alumnos={alumnos}
              cursos={cursos}
              pushToast={pushToast}
            />
          )}

          {page === "notificaciones" &&
            !["preceptor", "admin"].includes(session?.rol) && (
              <NotificacionesPage
                notificaciones={notificaciones}
                isAlumno={isAlumno}
              />
            )}
        </div>
      </div>

      {modalAlumno && (
        <div
          className="modal-overlay open"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setModalAlumno(null)
          }
        >
          <form className="modal" onSubmit={saveAlumno}>
            <div className="modal-title">
              {modalAlumno.mode === "new" ? "Nuevo alumno" : "Editar alumno"}
            </div>
            <div className="modal-sub">
              Los cambios se guardan en PostgreSQL.
            </div>
            <div className="field">
              <label>DNI</label>
              <input
                value={newAlumno.dni}
                onChange={(e) =>
                  setNewAlumno({ ...newAlumno, dni: e.target.value })
                }
                disabled={modalAlumno.mode === "edit"}
                required
              />
            </div>
            <div className="field">
              <label>Apellido</label>
              <input
                value={newAlumno.apellido}
                onChange={(e) =>
                  setNewAlumno({ ...newAlumno, apellido: e.target.value })
                }
                required
              />
            </div>
            <div className="field">
              <label>Nombre</label>
              <input
                value={newAlumno.nombre}
                onChange={(e) =>
                  setNewAlumno({ ...newAlumno, nombre: e.target.value })
                }
                required
              />
            </div>
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                value={newAlumno.email}
                onChange={(e) =>
                  setNewAlumno({ ...newAlumno, email: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label>Curso</label>
              <select
                value={newAlumno.id_curso}
                onChange={(e) =>
                  setNewAlumno({ ...newAlumno, id_curso: e.target.value })
                }
                disabled={newAlumno.estado !== "Activo"}
              >
                <option value="">Sin curso</option>
                {cursos.map((curso) => (
                  <option key={curso.id_curso} value={curso.id_curso}>
                    {curso.anio}° {curso.division}°
                    {curso.especialidad && ` — ${curso.especialidad}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Estado</label>
              <select
                value={newAlumno.estado}
                onChange={(e) =>
                  setNewAlumno({
                    ...newAlumno,
                    estado: e.target.value,
                    id_curso:
                      e.target.value === "Activo" ? newAlumno.id_curso : "",
                  })
                }
              >
                {ESTADOS_ALUMNO.map((estado) => (
                  <option key={estado}>{estado}</option>
                ))}
              </select>
            </div>

            <div className="modal-footer">
              {modalAlumno.mode === "edit" && canManageStudents && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={async () => {
                    const alumno = modalAlumno.alumno;

                    if (
                      !window.confirm(
                        `¿Seguro que querés eliminar a ${alumno.nombre} ${alumno.apellido}? Esta acción no se puede deshacer.`,
                      )
                    )
                      return;

                    try {
                      await apiFetch(
                        `/alumnos/${encodeURIComponent(alumno.dni)}`,
                        { method: "DELETE" },
                      );

                      setModalAlumno(null);
                      await loadCoreData();
                      pushToast("Alumno eliminado");
                    } catch (error) {
                      pushToast(error.message, "warn");
                    }
                  }}
                >
                  Eliminar alumno
                </button>
              )}

              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setModalAlumno(null)}
              >
                Cancelar
              </button>

              <button type="submit" className="btn btn-blue">
                Guardar ✓
              </button>
            </div>
          </form>
        </div>
      )}

      {modalDocente && (
        <div
          className="modal-overlay open"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setModalDocente(null)
          }
        >
          <form className="modal teacher-modal" onSubmit={saveDocente}>
            <div className="modal-title">
              {modalDocente.mode === "new"
                ? "Agregar docente"
                : "Editar docente"}
            </div>
            <div className="field">
              <label htmlFor="teacher-dni">DNI</label>
              <input
                id="teacher-dni"
                inputMode="numeric"
                value={docenteForm.dni}
                onChange={(event) =>
                  setDocenteForm({
                    ...docenteForm,
                    dni: event.target.value.replace(/\D/g, ""),
                  })
                }
                disabled={modalDocente.mode === "edit"}
                required
              />
            </div>
            <div className="teacher-form-grid">
              <div className="field">
                <label htmlFor="teacher-surname">Apellido</label>
                <input
                  id="teacher-surname"
                  value={docenteForm.apellido}
                  onChange={(event) =>
                    setDocenteForm({
                      ...docenteForm,
                      apellido: event.target.value,
                    })
                  }
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="teacher-name">Nombre</label>
                <input
                  id="teacher-name"
                  value={docenteForm.nombre}
                  onChange={(event) =>
                    setDocenteForm({
                      ...docenteForm,
                      nombre: event.target.value,
                    })
                  }
                  required
                />
              </div>
            </div>
            <div className="teacher-form-grid">
              <div className="field">
                <label htmlFor="teacher-email">Email</label>
                <input
                  id="teacher-email"
                  type="email"
                  value={docenteForm.email}
                  onChange={(event) =>
                    setDocenteForm({
                      ...docenteForm,
                      email: event.target.value,
                    })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="teacher-phone">Teléfono</label>
                <input
                  id="teacher-phone"
                  value={docenteForm.telefono}
                  onChange={(event) =>
                    setDocenteForm({
                      ...docenteForm,
                      telefono: event.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="teacher-status">Estado</label>
              <select
                id="teacher-status"
                value={docenteForm.estado}
                onChange={(event) =>
                  setDocenteForm({
                    ...docenteForm,
                    estado: event.target.value,
                    asignaciones:
                      event.target.value === "Baja"
                        ? []
                        : docenteForm.asignaciones,
                  })
                }
              >
                {["Activo", "Baja"].map((estado) => (
                  <option key={estado}>{estado}</option>
                ))}
              </select>
            </div>

            <div className="teacher-assignments-header">
              <strong>Materias y cursos asignados</strong>
              {docenteForm.estado !== "Baja" && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={addDocenteAssignment}
                >
                  + Agregar materia
                </button>
              )}
            </div>
            {docenteForm.asignaciones.map((assignment, index) => {
              const usedByOthers = new Set(
                docenteForm.asignaciones
                  .filter((_item, assignmentIndex) => assignmentIndex !== index)
                  .map((item) => item.codigo_materia),
              );
              const subjectCourses = cursos.filter(
                (curso) =>
                  String(curso.ciclo_lectivo) === String(selectedCycleYear) &&
                  curso.materias?.some(
                    (materia) =>
                      (typeof materia === "string"
                        ? materia
                        : materia.codigo) === assignment.codigo_materia,
                  ),
              );
              return (
                <div
                  className="teacher-assignment"
                  key={`${assignment.codigo_materia}-${index}`}
                >
                  <div className="teacher-assignment-heading">
                    <select
                      aria-label="Materia asignada"
                      value={assignment.codigo_materia}
                      onChange={(event) =>
                        updateDocenteAssignment(index, {
                          codigo_materia: event.target.value,
                          cursos: [],
                        })
                      }
                    >
                      {materias
                        .filter((materia) => !usedByOthers.has(materia.codigo))
                        .map((materia) => (
                          <option key={materia.codigo} value={materia.codigo}>
                            {materia.nombre}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setDocenteForm((current) => ({
                          ...current,
                          asignaciones: current.asignaciones.filter(
                            (_item, assignmentIndex) =>
                              assignmentIndex !== index,
                          ),
                        }))
                      }
                    >
                      Quitar
                    </button>
                  </div>
                  <div className="teacher-course-options">
                    {subjectCourses.map((curso) => {
                      const checked = assignment.cursos.includes(
                        String(curso.id_curso),
                      );
                      return (
                        <label
                          key={curso.id_curso}
                          className="teacher-course-option"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              updateDocenteAssignment(index, {
                                cursos: event.target.checked
                                  ? [
                                      ...assignment.cursos,
                                      String(curso.id_curso),
                                    ]
                                  : assignment.cursos.filter(
                                      (id) => id !== String(curso.id_curso),
                                    ),
                              })
                            }
                          />
                          <span>
                            {curso.anio}° {curso.division}
                            {curso.especialidad && ` — ${curso.especialidad}`}
                          </span>
                        </label>
                      );
                    })}
                    {!subjectCourses.length && (
                      <span className="muted-text">
                        No hay cursos con esta materia; se puede asignar la
                        materia sin cursos.
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {!docenteForm.asignaciones.length && (
              <div className="empty-state">
                {docenteForm.estado === "Baja"
                  ? "Al guardar, el docente quedará sin materias ni cursos asignados."
                  : "Todavía no hay materias ni cursos asignados."}
              </div>
            )}

            <div className="modal-footer">
              {modalDocente.mode === "edit" && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => deleteDocente(modalDocente.docente)}
                >
                  Eliminar docente
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setModalDocente(null)}
              >
                Cancelar
              </button>
              <button type="submit" className="btn btn-blue">
                Guardar docente
              </button>
            </div>
          </form>
        </div>
      )}

      {modalCurso && (
        <div
          className="modal-overlay open"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setModalCurso(null)
          }
        >
          <form className="modal" onSubmit={saveCurso}>
            <div className="modal-title">
              {modalCurso.mode === "new" ? "Nuevo curso" : "Editar curso"}
            </div>
            <div className="field">
              <label htmlFor="course-year">Año</label>
              <select
                id="course-year"
                value={cursoForm.anio}
                onChange={(event) => {
                  const anio = event.target.value;
                  setCursoForm((current) => ({
                    ...current,
                    anio,
                    especialidad:
                      Number(anio) <= 2
                        ? ""
                        : current.especialidad || "Automotores",
                  }));
                }}
              >
                {[1, 2, 3, 4, 5, 6].map((anio) => (
                  <option key={anio} value={anio}>
                    {anio}°
                  </option>
                ))}
              </select>
            </div>
            {Number(cursoForm.anio) >= 3 && (
              <div className="field">
                <label htmlFor="course-specialty">Especialidad</label>
                <select
                  id="course-specialty"
                  value={cursoForm.especialidad}
                  onChange={(event) =>
                    setCursoForm({
                      ...cursoForm,
                      especialidad: event.target.value,
                    })
                  }
                >
                  <option value="Automotores">Automotores</option>
                  <option value="Computación">Computación</option>
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="course-shift">Turno</label>
              <select
                id="course-shift"
                value={cursoForm.turno_id}
                onChange={(event) =>
                  setCursoForm({ ...cursoForm, turno_id: event.target.value })
                }
              >
                <option value="">Sin turno</option>
                {["Mañana", "Tarde", "Noche"].map((jornada) => {
                  const turno = turnos.find((item) => item.jornada === jornada);
                  return (
                    turno && (
                      <option key={turno.id_turno} value={turno.id_turno}>
                        {jornada}
                      </option>
                    )
                  );
                })}
              </select>
            </div>
            <div className="field">
              <label>Materias del curso</label>
              <div className="course-subject-options">
                {materias.map((materia) => (
                  <label className="course-subject-option" key={materia.codigo}>
                    <input
                      type="checkbox"
                      checked={cursoForm.materias.includes(materia.codigo)}
                      onChange={(event) =>
                        setCursoForm((current) => ({
                          ...current,
                          materias: event.target.checked
                            ? [...current.materias, materia.codigo]
                            : current.materias.filter(
                                (codigo) => codigo !== materia.codigo,
                              ),
                        }))
                      }
                    />
                    <span>{materia.nombre}</span>
                  </label>
                ))}
                {!materias.length && (
                  <div className="empty-state">No hay materias cargadas.</div>
                )}
              </div>
            </div>
            {modalCurso.mode === "edit" && (
              <div className="course-delete-warning" role="note">
                Eliminar no se puede deshacer. No se pueden eliminar cursos con
                alumnos o notas asociadas.
              </div>
            )}
            <div className="modal-footer">
              {modalCurso.mode === "edit" && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => deleteCurso(modalCurso.curso)}
                >
                  Eliminar curso
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setModalCurso(null)}
              >
                Cancelar
              </button>
              <button type="submit" className="btn btn-blue">
                Guardar curso
              </button>
            </div>
          </form>
        </div>
      )}

      {modalMateria && (
        <div
          className="modal-overlay open"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setModalMateria(null)
          }
        >
          <form className="modal" onSubmit={saveMateria}>
            <div className="modal-title">
              {modalMateria.mode === "new" ? "Nueva materia" : "Editar materia"}
            </div>
            <div className="modal-sub">
              Administrá la materia del catálogo global y su asignación al ciclo lectivo.
            </div>
            {modalMateria.mode === "new" && (
              <div className="field">
                <label htmlFor="subject-code">Código</label>
                <input
                  id="subject-code"
                  value={materiaForm.codigo}
                  onChange={(event) =>
                    setMateriaForm({
                      ...materiaForm,
                      codigo: event.target.value.toUpperCase(),
                    })
                  }
                  maxLength="20"
                  pattern="[A-Za-z0-9_-]{2,20}"
                  title="Usá entre 2 y 20 letras, números, guiones o guiones bajos."
                  required
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="subject-name">Nombre</label>
              <input
                id="subject-name"
                value={materiaForm.nombre}
                onChange={(event) =>
                  setMateriaForm({ ...materiaForm, nombre: event.target.value })
                }
                maxLength="100"
                required
              />
            </div>
            {modalMateria.mode === "edit" && (
              <div className="course-delete-warning" role="note">
                El nombre se comparte entre todos los ciclos. Esta acción quita
                la materia solo del ciclo actual.
              </div>
            )}
            <div className="modal-footer">
              {modalMateria.mode === "edit" && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => deleteMateria(modalMateria.materia)}
                >
                  Quitar del ciclo
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setModalMateria(null)}
              >
                Cancelar
              </button>
              <button type="submit" className="btn btn-blue">
                Guardar materia
              </button>
            </div>
          </form>
        </div>
      )}

      {modalNota && (
        <div
          className="modal-overlay open"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setModalNota(null)
          }
        >
          <form className="modal" onSubmit={saveNotas}>
            <div className="modal-title">Cargar / editar notas</div>
            <div className="modal-sub">
              {modalNota.apellido}, {modalNota.nombre} — DNI: {modalNota.dni} —{" "}
              {
                materias.find(
                  (materia) => materia.codigo === modalNota.codigo_materia,
                )?.nombre
              }
            </div>

            {[
              [
                ["BIMESTRE_1", "1er Bime"],
                ["BIMESTRE_2", "2do Bime"],
                [
                  "CUATRIMESTRE_1",
                  "Cuat. 1",
                  suggestedAverages().cuatrimestre1,
                ],
              ],
              [
                ["BIMESTRE_3", "3er Bime"],
                ["BIMESTRE_4", "4to Bime"],
                [
                  "CUATRIMESTRE_2",
                  "Cuat. 2",
                  suggestedAverages().cuatrimestre2,
                ],
              ],
            ].map((row, rowIndex) => (
              <div key={rowIndex} className="nota-grid">
                {row.map(([key, label, suggestion]) => (
                  <div key={key} className="nota-field">
                    <label htmlFor={`grade-${key}`}>{label}</label>
                    <input
                      id={`grade-${key}`}
                      type="number"
                      min="1"
                      max="10"
                      step="0.01"
                      value={notaForm[key]}
                      placeholder={suggestion === "—" ? "" : suggestion}
                      onChange={(event) =>
                        setNotaForm({
                          ...notaForm,
                          [key]: event.target.value,
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            ))}

            <div
              className={`nota-grid nota-grid-final ${isFailedGrade(notaForm.FINAL) || isFailedGrade(notaForm.DICIEMBRE) ? "nota-grid-final-remedial" : ""} ${isFailedGrade(notaForm.FINAL) && !isFailedGrade(notaForm.DICIEMBRE) ? "nota-grid-final-pair" : ""}`}
            >
              <div className="nota-field">
                <label htmlFor="grade-FINAL">Final</label>
                <input
                  id="grade-FINAL"
                  type="number"
                  min="1"
                  max="10"
                  step="0.01"
                  value={notaForm.FINAL}
                  placeholder={
                    suggestedAverages().final === "—"
                      ? ""
                      : suggestedAverages().final
                  }
                  onChange={(event) =>
                    setNotaForm({ ...notaForm, FINAL: event.target.value })
                  }
                />
              </div>
              {isFailedGrade(notaForm.FINAL) && (
                <div className="nota-field">
                  <label htmlFor="grade-DICIEMBRE">Diciembre</label>
                  <input
                    id="grade-DICIEMBRE"
                    type="number"
                    min="1"
                    max="10"
                    step="0.01"
                    value={notaForm.DICIEMBRE}
                    onChange={(event) =>
                      setNotaForm({
                        ...notaForm,
                        DICIEMBRE: event.target.value,
                      })
                    }
                  />
                </div>
              )}
              {isFailedGrade(notaForm.DICIEMBRE) && (
                <div className="nota-field">
                  <label htmlFor="grade-FEBRERO">Febrero</label>
                  <input
                    id="grade-FEBRERO"
                    type="number"
                    min="1"
                    max="10"
                    step="0.01"
                    value={notaForm.FEBRERO}
                    onChange={(event) =>
                      setNotaForm({ ...notaForm, FEBRERO: event.target.value })
                    }
                  />
                </div>
              )}
            </div>

            <label className="notification-option">
              <input
                type="checkbox"
                checked={notificarNotaGeneral}
                onChange={(event) =>
                  setNotificarNotaGeneral(event.target.checked)
                }
              />
              <span>Notificar al alumno</span>
            </label>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setModalNota(null)}
              >
                Cancelar
              </button>

              <button type="submit" className="btn btn-blue">
                Guardar notas ✓
              </button>
            </div>
          </form>
        </div>
      )}

      {modalNotaIndividual && (
        <div
          className="modal-overlay open"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setModalNotaIndividual(null)
          }
        >
          <div className="modal individual-notes-modal">
            <div className="modal-title">📝 Notas individuales</div>
            <div className="modal-sub">
              {modalNotaIndividual.apellido}, {modalNotaIndividual.nombre} —{" "}
              {
                materias.find(
                  (materia) =>
                    materia.codigo === modalNotaIndividual.codigo_materia,
                )?.nombre
              }
            </div>

            <form onSubmit={saveIndividualNote}>
              <div className="field">
                <label htmlFor="individual-period">Bimestre / período</label>
                <select
                  id="individual-period"
                  value={notaIndividualForm.tipo_evaluacion}
                  onChange={(event) =>
                    setNotaIndividualForm({
                      id_nota_individual: null,
                      tipo_evaluacion: event.target.value,
                      tema: "",
                      estado: "Entregado",
                      calificacion: "1",
                      adeuda: null,
                      notificar_alumno: true,
                    })
                  }
                >
                  {PERIODOS_NOTA_INDIVIDUAL.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="individual-topic">Tema</label>
                <input
                  id="individual-topic"
                  value={notaIndividualForm.tema}
                  onChange={(event) =>
                    setNotaIndividualForm({
                      ...notaIndividualForm,
                      tema: event.target.value,
                    })
                  }
                  placeholder="Tema o actividad evaluada"
                  required
                />
              </div>
              <div className="individual-grade-fields">
                <div className="field">
                  <label htmlFor="individual-status">Estado</label>
                  <select
                    id="individual-status"
                    value={notaIndividualForm.estado}
                    onChange={(event) => {
                      const estado = event.target.value;
                      setNotaIndividualForm({
                        ...notaIndividualForm,
                        estado,
                        calificacion:
                          estado === "No realizó"
                            ? "1"
                            : notaIndividualForm.calificacion,
                      });
                    }}
                  >
                    <option value="No realizó">No realizó</option>
                    <option value="Entregado">Entregado</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="individual-grade">Nota</label>
                  <input
                    id="individual-grade"
                    type="number"
                    min="1"
                    max="10"
                    step="0.01"
                    value={notaIndividualForm.calificacion}
                    onChange={(event) =>
                      setNotaIndividualForm({
                        ...notaIndividualForm,
                        calificacion: event.target.value,
                      })
                    }
                    disabled={notaIndividualForm.estado === "No realizó"}
                    required
                  />
                </div>
              </div>
              {Number(notaIndividualForm.calificacion) < 6 && (
                <div className="field">
                  <label htmlFor="individual-owes-topic">
                    ¿Adeuda el tema?
                  </label>
                  <select
                    id="individual-owes-topic"
                    value={
                      notaIndividualForm.adeuda == null
                        ? ""
                        : String(notaIndividualForm.adeuda)
                    }
                    onChange={(event) =>
                      setNotaIndividualForm({
                        ...notaIndividualForm,
                        adeuda:
                          event.target.value === ""
                            ? null
                            : event.target.value === "true",
                      })
                    }
                  >
                    <option value="">Seleccionar…</option>
                    <option value="false">No</option>
                    <option value="true">Sí</option>
                  </select>
                </div>
              )}
              <label className="notification-option">
                <input
                  type="checkbox"
                  checked={notaIndividualForm.notificar_alumno}
                  onChange={(event) =>
                    setNotaIndividualForm({
                      ...notaIndividualForm,
                      notificar_alumno: event.target.checked,
                    })
                  }
                />
                <span>Notificar al alumno</span>
              </label>
              <div className="modal-footer individual-form-footer">
                {notaIndividualForm.id_nota_individual && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      setNotaIndividualForm({
                        id_nota_individual: null,
                        tipo_evaluacion: notaIndividualForm.tipo_evaluacion,
                        tema: "",
                        estado: "Entregado",
                        calificacion: "1",
                        adeuda: null,
                        notificar_alumno: true,
                      })
                    }
                  >
                    Cancelar edición
                  </button>
                )}
                <button type="submit" className="btn btn-blue">
                  {notaIndividualForm.id_nota_individual
                    ? "Guardar cambios"
                    : "Agregar nota"}
                </button>
              </div>
            </form>

            <div className="individual-notes-list">
              <div className="individual-notes-list-title">
                Evaluaciones:{" "}
                {
                  PERIODOS_NOTA_INDIVIDUAL.find(
                    ([value]) => value === notaIndividualForm.tipo_evaluacion,
                  )?.[1]
                }
              </div>
              {notaIndividualError ? (
                <div className="empty-state">{notaIndividualError}</div>
              ) : notasIndividualesLoading ? (
                <div className="empty-state">Cargando evaluaciones…</div>
              ) : (
                notasIndividuales
                  .filter(
                    (nota) =>
                      nota.tipo_evaluacion ===
                      notaIndividualForm.tipo_evaluacion,
                  )
                  .map((nota) => (
                    <div
                      className="individual-note-item"
                      key={nota.id_nota_individual}
                    >
                      <div>
                        <strong>{nota.tema}</strong>
                        <span>
                          {nota.estado} · Nota: {nota.calificacion}
                          {Number(nota.calificacion) < 6 &&
                            nota.adeuda != null &&
                            ` · Adeuda el tema: ${nota.adeuda ? "Sí" : "No"}`}
                        </span>
                      </div>
                      <div className="individual-note-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => editIndividualNote(nota)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => deleteIndividualNote(nota)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  ))
              )}
              {!notaIndividualError &&
                !notasIndividualesLoading &&
                !notasIndividuales.some(
                  (nota) =>
                    nota.tipo_evaluacion === notaIndividualForm.tipo_evaluacion,
                ) && (
                  <div className="empty-state">
                    Todavía no hay notas individuales para este período.
                  </div>
                )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setModalNotaIndividual(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-container">
        {toast.map((item) => (
          <div
            key={item.id}
            className={`toast show ${item.type === "warn" ? "warn-toast" : "ok-toast"}`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardPage({ dashboard, alumnos, notificaciones, cursos }) {
  const alumnosConPromedioBajo = alumnos.filter(
    (alumno) =>
      alumno.estado === "Activo" &&
      alumno.promedio_anio !== null &&
      alumno.promedio_anio !== undefined &&
      Number(alumno.promedio_anio) < 6,
  ).length;
  const actividadReciente = notificaciones.slice(0, 50);

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card blue" data-icon="👥">
          <div className="stat-label">Alumnos activos</div>
          <div className="stat-value">{dashboard.alumnos_activos}</div>
          <div className="stat-sub">En el ciclo lectivo seleccionado</div>
        </div>
        <div className="stat-card warn" data-icon="⚠️">
          <div className="stat-label">Promedio bajo</div>
          <div className="stat-value">{alumnosConPromedioBajo}</div>
          <div className="stat-sub">Alumnos activos con promedio menor a 6</div>
        </div>
        <div className="stat-card" data-icon="📚">
          <div className="stat-label">Cursos</div>
          <div className="stat-value">{cursos.length}</div>
          <div className="stat-sub">En el ciclo lectivo seleccionado</div>
        </div>
        <div className="stat-card ok" data-icon="📝">
          <div className="stat-label">Calificaciones cargadas</div>
          <div className="stat-value">{dashboard.calificaciones_cargadas}</div>
          <div className="stat-sub">En el ciclo lectivo seleccionado</div>
        </div>
      </div>

      <div className="section-header">
        <div className="section-title">Actividad reciente</div>
        <span className="stat-sub">
          Últimas {actividadReciente.length} calificaciones (máximo 50)
        </span>
      </div>
      <div className="card">
        {actividadReciente.map((item) => (
          <div className="activity-item" key={`${item.id_nota}-${item.fecha}`}>
            <div
              className={`activity-dot ${item.tipo === "Crítica" ? "dot-warn" : "dot-ok"}`}
            ></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                {item.apellido}, {item.nombre} — {item.materia}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {item.tipo_evaluacion} · nota {item.calificacion}
              </div>
            </div>
            <span
              className={`badge ${item.tipo === "Crítica" ? "badge-warn" : "badge-ok"}`}
            >
              {item.tipo}
            </span>
            <span className="stat-sub">
              {item.fecha
                ? new Date(item.fecha).toLocaleDateString("es-AR")
                : "Sin fecha"}
            </span>
          </div>
        ))}
        {!actividadReciente.length && (
          <div className="empty-state">
            Todavía no hay actividad registrada.
          </div>
        )}
      </div>
    </>
  );
}

function AlumnosPage({
  alumnos,
  cursos,
  search,
  setSearch,
  filterCurso,
  setFilterCurso,
  filterEstado,
  setFilterEstado,
  canManageStudents,
  openNewAlumno,
  openEditAlumno,
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(alumnos.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const pageAlumnos = alumnos.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterCurso, filterEstado]);

  return (
    <>
      <div className="section-header">
        <div className="section-title">Alumnos</div>
        {canManageStudents && (
          <button className="btn btn-blue" onClick={openNewAlumno}>
            + Nuevo alumno
          </button>
        )}
      </div>
      <div className="card">
        <div className="filters">
          <input
            type="search"
            placeholder="Buscar por nombre, apellido o DNI..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
          />
          <select
            value={filterCurso}
            onChange={(e) => {
              setFilterCurso(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">Todos los cursos</option>
            {cursos.map((curso) => (
              <option key={curso.id_curso} value={curso.id_curso}>
                {curso.anio}° {curso.division}°
                {curso.especialidad && ` — ${curso.especialidad}`}
              </option>
            ))}
          </select>
          <select
            value={filterEstado}
            onChange={(e) => {
              setFilterEstado(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">Todos los estados</option>
            {ESTADOS_ALUMNO.map((estado) => (
              <option key={estado} value={estado}>
                {estado}
              </option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>DNI</th>
                <th>Apellido(s) y nombre(s)</th>
                <th>Curso</th>
                <th>Estado</th>
                {canManageStudents && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {pageAlumnos.map((alumno) => (
                <tr key={alumno.dni}>
                  <td>{alumno.dni}</td>
                  <td>
                    <strong>
                      {alumno.apellido?.toLocaleUpperCase("es-AR")},{" "}
                      {alumno.nombre}
                    </strong>
                  </td>
                  <td>
                    <span className="badge badge-blue">
                      {alumno.anio
                        ? `${alumno.anio}° ${alumno.division}°${alumno.especialidad ? ` — ${alumno.especialidad}` : ""}`
                        : "—"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`badge ${String(alumno.estado).toLowerCase() === "activo" ? "badge-ok" : "badge-warn"}`}
                    >
                      {alumno.estado}
                    </span>
                  </td>
                  {canManageStudents && (
                    <td>
                      <div className="action-row">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => openEditAlumno(alumno)}
                        >
                          Editar
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!alumnos.length && (
                <tr>
                  <td colSpan={canManageStudents ? 5 : 4}>
                    <div className="empty-state">
                      No hay alumnos que coincidan con el filtro.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {alumnos.length > 0 && (
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            totalItems={alumnos.length}
            onPageChange={setCurrentPage}
          />
        )}
      </div>
    </>
  );
}

function DocentesPage({
  docentes,
  cursos,
  materias,
  canManageTeachers,
  openNewDocente,
  openEditDocente,
}) {
  const [search, setSearch] = useState("");
  const [filterMateria, setFilterMateria] = useState("");
  const [filterCurso, setFilterCurso] = useState("");
  const [filterEstado, setFilterEstado] = useState("Activo");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  const filteredDocentes = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-AR");
    return docentes.filter((docente) => {
      const nombreCompleto =
        `${docente.apellido || ""} ${docente.nombre || ""}`.toLocaleLowerCase(
          "es-AR",
        );
      const matchSearch =
        !term ||
        nombreCompleto.includes(term) ||
        String(docente.dni).includes(term);
      const matchMateria =
        !filterMateria ||
        docente.asignaciones?.some(
          (assignment) => assignment.codigo_materia === filterMateria,
        ) ||
        docente.materias
          ?.toLocaleLowerCase("es-AR")
          .includes(
            materias
              .find((materia) => materia.codigo === filterMateria)
              ?.nombre.toLocaleLowerCase("es-AR") || "",
          );
      const courseLabel = cursos.find(
        (curso) => String(curso.id_curso) === String(filterCurso),
      )?.label;
      const matchCurso =
        !filterCurso ||
        docente.asignaciones?.some((assignment) =>
          assignment.cursos?.some(
            (curso) => String(curso.id_curso) === String(filterCurso),
          ),
        ) ||
        Boolean(courseLabel && docente.cursos?.includes(courseLabel));
      const matchEstado =
        !filterEstado ||
        (docente.estado || "Activo").toLocaleLowerCase("es-AR") ===
          filterEstado.toLocaleLowerCase("es-AR");
      return matchSearch && matchMateria && matchCurso && matchEstado;
    });
  }, [
    docentes,
    search,
    filterMateria,
    filterCurso,
    filterEstado,
    materias,
    cursos,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredDocentes.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const pageDocentes = filteredDocentes.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterMateria, filterCurso, filterEstado]);

  return (
    <>
      <div className="section-header">
        <div className="section-title">Docentes</div>
        {canManageTeachers && (
          <button
            type="button"
            className="btn btn-blue"
            onClick={openNewDocente}
          >
            + Agregar docente
          </button>
        )}
      </div>
      <div className="card">
        <div className="filters">
          <input
            type="search"
            placeholder="Buscar por nombre, apellido o DNI..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setCurrentPage(1);
            }}
          />
          <select
            value={filterMateria}
            onChange={(event) => {
              setFilterMateria(event.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">Todas las materias</option>
            {materias.map((materia) => (
              <option key={materia.codigo} value={materia.codigo}>
                {materia.nombre}
              </option>
            ))}
          </select>
          <select
            value={filterCurso}
            onChange={(event) => {
              setFilterCurso(event.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">Todos los cursos</option>
            {cursos.map((curso) => (
              <option key={curso.id_curso} value={curso.id_curso}>
                {curso.anio}° {curso.division}°
                {curso.especialidad && ` — ${curso.especialidad}`}
              </option>
            ))}
          </select>
          <select
            value={filterEstado}
            onChange={(event) => {
              setFilterEstado(event.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">Todos los estados</option>
            {["Activo", "Baja"].map((estado) => (
              <option key={estado} value={estado}>
                {estado}
              </option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>DNI</th>
                <th>Apellido y nombre</th>
                <th>Materia(s)</th>
                <th>Curso(s)</th>
                <th>Estado</th>
                {canManageTeachers && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {pageDocentes.map((docente) => (
                <tr key={docente.dni}>
                  <td>{docente.dni}</td>
                  <td>
                    <strong>
                      {docente.apellido?.toLocaleUpperCase("es-AR")},{" "}
                      {docente.nombre}
                    </strong>
                  </td>
                  <td>{docente.materias || "—"}</td>
                  <td>{docente.cursos || "—"}</td>
                  <td>
                    <span
                      className={`badge ${docente.estado === "Activo" ? "badge-ok" : docente.estado === "Baja" ? "badge-warn" : "badge-blue"}`}
                    >
                      {docente.estado || "Activo"}
                    </span>
                  </td>
                  {canManageTeachers && (
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openEditDocente(docente)}
                      >
                        Editar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!filteredDocentes.length && (
                <tr>
                  <td colSpan={canManageTeachers ? 6 : 5}>
                    <div className="empty-state">
                      No hay docentes que coincidan con los filtros.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredDocentes.length > 0 && (
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            totalItems={filteredDocentes.length}
            onPageChange={setCurrentPage}
          />
        )}
      </div>
    </>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  onPageChange,
}) {
  const pageSize = 50;
  const firstItem = (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="pagination">
      <span className="pagination-summary">
        Mostrando {firstItem}–{lastItem} de {totalItems}
      </span>
      <div className="pagination-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
        >
          Anterior
        </button>
        <span className="pagination-page">
          Página {currentPage} de {totalPages}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function MateriasPage({
  materias,
  catalogoMaterias,
  openNewMateria,
  openEditMateria,
  onAssignMateria,
}) {
  const [selectedSubjectCode, setSelectedSubjectCode] = useState(null);
  const [codigoParaAsignar, setCodigoParaAsignar] = useState("");
  const selectedSubject = materias.find(
    (materia) => materia.codigo === selectedSubjectCode,
  );
  const materiasDisponibles = catalogoMaterias.filter(
    (materia) => !materia.asignada,
  );

  function toggleSubject(codigo) {
    setSelectedSubjectCode((currentCode) =>
      currentCode === codigo ? null : codigo,
    );
  }

  return (
    <>
      <div className="section-header">
        <div className="section-title">Materias</div>
        <button className="btn btn-blue" onClick={openNewMateria}>
          + Nueva materia
        </button>
      </div>
      <p className="muted-text">
        El catálogo es global; asigná al ciclo actual las materias que va a
        utilizar. Cada materia se registra una sola vez.
      </p>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="filters">
          <select
            aria-label="Materia existente para asignar al ciclo"
            value={codigoParaAsignar}
            onChange={(event) => setCodigoParaAsignar(event.target.value)}
            disabled={!materiasDisponibles.length}
          >
            <option value="">
              {materiasDisponibles.length
                ? "Seleccionar materia existente..."
                : "Todas las materias están asignadas"}
            </option>
            {materiasDisponibles.map((materia) => (
              <option key={materia.codigo} value={materia.codigo}>
                {materia.nombre}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-blue"
            disabled={
              !materiasDisponibles.some(
                (materia) => materia.codigo === codigoParaAsignar,
              )
            }
            onClick={() => {
              onAssignMateria(codigoParaAsignar);
              setCodigoParaAsignar("");
            }}
          >
            Asignar materia existente
          </button>
        </div>
      </div>
      <div className="my-notas-grid">
        {materias.map((materia) => (
          <article
            key={materia.codigo}
            className={`materia-card course-card subject-card ${selectedSubjectCode === materia.codigo ? "selected" : ""}`}
          >
            <div className="materia-header">
              <div>
                <div className="materia-name">{materia.nombre}</div>
                <div className="materia-prof">Código: {materia.codigo}</div>
              </div>
              <span className="badge badge-blue">
                {materia.profesores.length}{" "}
                {materia.profesores.length === 1 ? "profesor" : "profesores"}
              </span>
            </div>
            <div className="course-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-expanded={selectedSubjectCode === materia.codigo}
                onClick={() => toggleSubject(materia.codigo)}
              >
                {selectedSubjectCode === materia.codigo
                  ? "Ocultar profesores"
                  : "Ver profesores"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => openEditMateria(materia)}
              >
                Editar
              </button>
            </div>
          </article>
        ))}
        {!materias.length && (
          <div className="empty-state">No hay materias para mostrar.</div>
        )}
      </div>
      {selectedSubject && (
        <div className="course-students">
          <div className="section-header">
            <div className="section-title">
              Profesores de {selectedSubject.nombre}
            </div>
            <span className="badge badge-blue">
              {selectedSubject.profesores.length} profesor(es)
            </span>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>DNI</th>
                    <th>Profesor</th>
                    <th>Cursos donde ejerce</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSubject.profesores.map((profesor) => (
                    <tr key={profesor.dni}>
                      <td>{profesor.dni}</td>
                      <td>
                        <strong>{profesor.nombre}</strong>
                      </td>
                      <td>
                        {profesor.cursos.length
                          ? profesor.cursos.join(", ")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                  {!selectedSubject.profesores.length && (
                    <tr>
                      <td colSpan="3">
                        <div className="empty-state">
                          Esta materia todavía no tiene profesores asignados.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CursosPage({
  cursos,
  materias,
  alumnos,
  canManageCourses,
  openNewCurso,
  openEditCurso,
}) {
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [expandedSubjects, setExpandedSubjects] = useState({});
  const selectedCourse = cursos.find(
    (curso) => curso.id_curso === selectedCourseId,
  );
  const courseAlumnos = alumnos.filter(
    (alumno) => String(alumno.id_curso) === String(selectedCourseId),
  );

  function toggleCourse(courseId) {
    setSelectedCourseId((currentId) =>
      currentId === courseId ? null : courseId,
    );
  }

  function toggleSubjects(courseId) {
    setExpandedSubjects((current) => ({
      ...current,
      [courseId]: !current[courseId],
    }));
  }

  return (
    <>
      <div className="section-header">
        <div className="section-title">Cursos y Divisiones</div>
        {canManageCourses && (
          <button className="btn btn-blue" onClick={openNewCurso}>
            + Nuevo curso
          </button>
        )}
      </div>
      <div className="my-notas-grid">
        {cursos.map((curso) => {
          const isSelected = selectedCourseId === curso.id_curso;
          const label = `${curso.anio}° ${curso.division}°${curso.especialidad ? ` — ${curso.especialidad}` : ""}`;
          return (
            <article
              key={curso.id_curso}
              className={`materia-card course-card ${isSelected ? "selected" : ""}`}
            >
              <div className="materia-header">
                <div className="materia-name">{label}</div>
                <span className="badge badge-blue">
                  {curso.cantidad_alumnos ?? courseAlumnos.length} alumnos
                </span>
              </div>
              <div className="materia-body">
                <div className="nota-row">
                  <span className="nota-row-label">Turno</span>
                  <span className="nota-row-val">
                    {curso.turno || "Sin turno asignado"}
                  </span>
                </div>
              </div>
              <div className="course-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-expanded={isSelected}
                  onClick={() => toggleCourse(curso.id_curso)}
                >
                  {isSelected ? "Ocultar alumnos" : "Ver alumnos"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-expanded={Boolean(expandedSubjects[curso.id_curso])}
                  onClick={() => toggleSubjects(curso.id_curso)}
                >
                  {expandedSubjects[curso.id_curso]
                    ? "Ocultar materias"
                    : "Ver materias"}
                </button>
                {canManageCourses && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => openEditCurso(curso)}
                  >
                    Editar
                  </button>
                )}
              </div>
              {expandedSubjects[curso.id_curso] && (
                <div className="course-subjects-summary">
                  <strong>Materias:</strong>{" "}
                  {curso.materias?.length
                    ? curso.materias
                        .map((materia) =>
                          typeof materia === "string"
                            ? materias.find((item) => item.codigo === materia)
                                ?.nombre || materia
                            : materia.nombre,
                        )
                        .join(", ")
                    : "Sin materias asignadas"}
                </div>
              )}
            </article>
          );
        })}
        {!cursos.length && (
          <div className="empty-state">No hay cursos para mostrar.</div>
        )}
      </div>
      {selectedCourse && (
        <div className="course-students">
          <div className="section-header">
            <div className="section-title">
              Alumnos de {selectedCourse.anio}° {selectedCourse.division}°
              {selectedCourse.especialidad && ` — ${selectedCourse.especialidad}`}
            </div>
            <span className="badge badge-blue">
              {courseAlumnos.length} alumnos
            </span>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>DNI</th>
                    <th>Apellido y nombre</th>
                    <th>Estado</th>
                    <th>Promedio</th>
                  </tr>
                </thead>
                <tbody>
                  {courseAlumnos.map((alumno) => (
                    <tr key={alumno.dni}>
                      <td>{alumno.dni}</td>
                      <td>
                        <strong>
                          {alumno.apellido}, {alumno.nombre}
                        </strong>
                      </td>
                      <td>{alumno.estado}</td>
                      <td>{Number(alumno.promedio || 0).toFixed(1)}</td>
                    </tr>
                  ))}
                  {!courseAlumnos.length && (
                    <tr>
                      <td colSpan="4">
                        <div className="empty-state">
                          Este curso todavía no tiene alumnos asignados.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PersonalAdminPage({
  resource,
  title,
  includeCargo = false,
  currentAdminDni,
  pushToast,
}) {
  const singular = resource === "preceptores" ? "preceptor" : "administrador";
  const [records, setRecords] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({
    dni: "",
    apellido: "",
    nombre: "",
    email: "",
    telefono: "",
    cargo: "",
    estado: "Activo",
  });
  const [filterEstado, setFilterEstado] = useState("Activo");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const searchTerms = search
    .trim()
    .toLocaleLowerCase("es-AR")
    .split(/\s+/)
    .filter(Boolean);
  const filteredRecords = records.filter((person) => {
    const searchableText = `${person.dni} ${person.apellido} ${person.nombre}`
      .toLocaleLowerCase("es-AR");
    return (
      (!filterEstado || person.estado === filterEstado) &&
      searchTerms.every((term) => searchableText.includes(term))
    );
  });

  async function loadRecords() {
    setLoading(true);
    try {
      setRecords(await apiFetch(`/${resource}`));
    } catch (error) {
      pushToast(error.message, "warn");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource]);

  function openNew() {
    setForm({
      dni: "",
      apellido: "",
      nombre: "",
      email: "",
      telefono: "",
      cargo: "",
      estado: "Activo",
    });
    setModal({ mode: "new" });
  }

  function openEdit(person) {
    setForm({
      dni: person.dni,
      apellido: person.apellido || "",
      nombre: person.nombre || "",
      email: person.email || "",
      telefono: person.telefono || "",
      cargo: person.cargo || "",
      estado: person.estado || "Activo",
    });
    setModal({ mode: "edit", person });
  }

  async function save(event) {
    event.preventDefault();
    const isNew = modal.mode === "new";
    const body = {
      ...form,
      cargo: includeCargo ? form.cargo || null : undefined,
    };
    try {
      await apiFetch(
        isNew
          ? `/${resource}`
          : `/${resource}/${encodeURIComponent(modal.person.dni)}`,
        {
          method: isNew ? "POST" : "PUT",
          body: JSON.stringify(body),
        },
      );
      setModal(null);
      pushToast(
        `${singular[0].toUpperCase()}${singular.slice(1)} ${isNew ? "agregado" : "actualizado"}`,
      );
      await loadRecords();
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  async function remove(person) {
    if (
      resource === "administradores" &&
      String(person.dni) === String(currentAdminDni)
    ) {
      pushToast("No podés eliminar tu propia cuenta de administrador", "warn");
      return;
    }
    if (
      !window.confirm(
        `¿Eliminar a ${person.apellido}, ${person.nombre}? Esta acción también elimina su cuenta de acceso y no se puede deshacer.`,
      )
    )
      return;
    try {
      await apiFetch(`/${resource}/${encodeURIComponent(person.dni)}`, {
        method: "DELETE",
      });
      setModal(null);
      pushToast(`${singular[0].toUpperCase()}${singular.slice(1)} eliminado`);
      await loadRecords();
    } catch (error) {
      pushToast(error.message, "warn");
    }
  }

  return (
    <>
      <div className="section-header">
        <div className="section-title">{title}</div>
        <button type="button" className="btn btn-blue" onClick={openNew}>
          + Agregar
        </button>
      </div>
      <div className="card">
        {loading ? (
          <div className="loading-line">Cargando…</div>
        ) : (
          <>
            <div className="filters">
              <input
                type="search"
                placeholder="Buscar por nombre, apellido o DNI..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                value={filterEstado}
                onChange={(event) => setFilterEstado(event.target.value)}
              >
                <option value="">Todos los estados</option>
                <option value="Activo">Activo</option>
                <option value="Baja">Baja</option>
              </select>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>DNI</th>
                    <th>Apellido(s) y nombre(s)</th>
                    <th>Email</th>
                    <th>Teléfono</th>
                    {includeCargo && <th>Cargo</th>}
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((person) => (
                    <tr key={person.dni}>
                      <td>{person.dni}</td>
                      <td>
                        <strong>
                          {person.apellido?.toLocaleUpperCase("es-AR")},{" "}
                          {person.nombre}
                        </strong>
                      </td>
                      <td>{person.email || "—"}</td>
                      <td>{person.telefono || "—"}</td>
                      {includeCargo && <td>{person.cargo || "—"}</td>}
                      <td>
                        <span
                          className={`badge ${person.estado === "Activo" ? "badge-ok" : "badge-warn"}`}
                        >
                          {person.estado || "Activo"}
                        </span>
                      </td>
                      <td>
                        <div className="action-row">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => openEdit(person)}
                          >
                            Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filteredRecords.length && (
                    <tr>
                      <td colSpan={includeCargo ? 7 : 6}>
                        <div className="empty-state">
                          No hay registros para mostrar.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {modal && (
        <div
          className="modal-overlay open"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setModal(null)
          }
        >
          <form className="modal" onSubmit={save}>
            <div className="modal-title">
              {modal.mode === "new"
                ? `Agregar ${singular}`
                : `Editar ${singular}`}
            </div>
            <div className="field">
              <label htmlFor={`${resource}-dni`}>DNI</label>
              <input
                id={`${resource}-dni`}
                inputMode="numeric"
                value={form.dni}
                onChange={(event) =>
                  setForm({
                    ...form,
                    dni: event.target.value.replace(/\D/g, ""),
                  })
                }
                disabled={modal.mode === "edit"}
                required
              />
            </div>
            <div className="field">
              <label htmlFor={`${resource}-surname`}>Apellido(s)</label>
              <input
                id={`${resource}-surname`}
                value={form.apellido}
                onChange={(event) =>
                  setForm({ ...form, apellido: event.target.value })
                }
                maxLength="80"
                required
              />
            </div>
            <div className="field">
              <label htmlFor={`${resource}-name`}>Nombre(s)</label>
              <input
                id={`${resource}-name`}
                value={form.nombre}
                onChange={(event) =>
                  setForm({ ...form, nombre: event.target.value })
                }
                maxLength="80"
                required
              />
            </div>
            <div className="field">
              <label htmlFor={`${resource}-email`}>Email</label>
              <input
                id={`${resource}-email`}
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
                maxLength="150"
              />
            </div>
            <div className="field">
              <label htmlFor={`${resource}-phone`}>Teléfono</label>
              <input
                id={`${resource}-phone`}
                value={form.telefono}
                onChange={(event) =>
                  setForm({ ...form, telefono: event.target.value })
                }
                maxLength="30"
              />
            </div>
            <div className="field">
              <label htmlFor={`${resource}-status`}>Estado</label>
              <select
                id={`${resource}-status`}
                value={form.estado}
                onChange={(event) =>
                  setForm({ ...form, estado: event.target.value })
                }
              >
                <option value="Activo">Activo</option>
                <option value="Baja">Baja</option>
              </select>
            </div>
            {includeCargo && (
              <div className="field">
                <label htmlFor="administrator-position">Cargo</label>
                <select
                  id="administrator-position"
                  value={form.cargo}
                  onChange={(event) =>
                    setForm({ ...form, cargo: event.target.value })
                  }
                >
                  <option value="">Sin cargo</option>
                  <option value="Regente">Regente</option>
                  <option value="Subregente">Subregente</option>
                </select>
              </div>
            )}
            {modal.mode === "edit" && (
              <div className="course-delete-warning" role="note">
                {resource === "administradores" &&
                String(modal.person.dni) === String(currentAdminDni)
                  ? "No podés eliminar tu propia cuenta de administrador."
                  : "Eliminar también borra la cuenta de acceso asociada. Se solicitará confirmación antes de hacerlo."}
              </div>
            )}
            <div className="modal-footer">
              {modal.mode === "edit" && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => remove(modal.person)}
                  disabled={
                    resource === "administradores" &&
                    String(modal.person.dni) === String(currentAdminDni)
                  }
                >
                  Eliminar
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setModal(null)}
              >
                Cancelar
              </button>
              <button type="submit" className="btn btn-blue">
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function CiclosLectivosPage({
  ciclos,
  nuevoAnio,
  setNuevoAnio,
  copiarDesde,
  setCopiarDesde,
  onCreate,
  onDelete,
}) {
  return (
    <>
      <div className="section-header">
        <div className="section-title">Administrar ciclos lectivos</div>
      </div>
      <form className="card cycle-create-form" onSubmit={onCreate}>
        <div className="filters cycle-create-fields">
          <input
            type="number"
            min="1900"
            max="2200"
            step="1"
            value={nuevoAnio}
            onChange={(event) => setNuevoAnio(event.target.value)}
            placeholder="Año del ciclo lectivo"
            aria-label="Año del nuevo ciclo lectivo"
            required
          />
          <label className="cycle-copy-field">
            <span>Copiar datos de:</span>
            <select
              value={copiarDesde}
              onChange={(event) => setCopiarDesde(event.target.value)}
              aria-label="Copiar datos de un ciclo existente"
            >
              <option value="">No copiar</option>
              {ciclos.map((ciclo) => (
                <option key={ciclo.id_ciclo_lectivo} value={ciclo.anio}>
                  {ciclo.anio}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-blue" type="submit">
            + Crear ciclo
          </button>
        </div>
      </form>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Año</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {ciclos.map((ciclo) => (
                <tr key={ciclo.id_ciclo_lectivo}>
                  <td>
                    <strong>{ciclo.anio}</strong>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => onDelete(ciclo)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {!ciclos.length && (
                <tr>
                  <td colSpan="2">
                    <div className="empty-state">
                      No hay ciclos lectivos para mostrar.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="course-delete-warning cycle-delete-warning" role="note">
        Solo se pueden eliminar ciclos lectivos que no tengan cursos,
        inscripciones, profesores asignados ni calificaciones.
      </div>
    </>
  );
}

function NotasPage({
  cursos,
  materias,
  alumnos,
  notaCurso,
  setNotaCurso,
  notaMateria,
  setNotaMateria,
  noteRows,
  openNotaModal,
  openIndividualNotesModal,
}) {
  return (
    <>
      <div className="section-header">
        <div className="section-title">Carga de Calificaciones</div>
      </div>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="filters">
          <select
            value={notaCurso}
            onChange={(e) => {
              setNotaCurso(e.target.value);
              setNotaMateria("");
            }}
          >
            <option value="">Seleccionar curso…</option>
            {cursos.map((curso) => (
              <option key={curso.id_curso} value={curso.id_curso}>
                {curso.anio}° {curso.division}°
                {curso.especialidad && ` — ${curso.especialidad}`}
              </option>
            ))}
          </select>
          <select
            value={notaMateria}
            onChange={(e) => setNotaMateria(e.target.value)}
            disabled={!notaCurso}
          >
            <option value="">Seleccionar materia…</option>
            {materias.map((materia) => (
              <option key={materia.codigo} value={materia.codigo}>
                {materia.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!notaCurso || !notaMateria ? (
        <div className="empty-state large">
          Seleccioná un curso y una materia para cargar calificaciones.
        </div>
      ) : !alumnos.some(
          (alumno) => String(alumno.id_curso) === String(notaCurso),
        ) ? (
        <div className="empty-state large">
          Este curso no tiene alumnos asignados.
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Apellido(s) y nombre(s)</th>
                  <th>Bim. 1</th>
                  <th>Bim. 2</th>
                  <th>Cuat. 1</th>
                  <th>Bim. 3</th>
                  <th>Bim. 4</th>
                  <th>Cuat. 2</th>
                  <th>Final</th>
                  <th>Diciembre</th>
                  <th>Febrero</th>
                  <th>Acciones</th>
                </tr>
              </thead>

              <tbody>
                {noteRows.map((row) => (
                  <tr key={row.dni}>
                    <td>
                      {row.apellido?.toLocaleUpperCase("es-AR")}, {row.nombre}
                    </td>
                    <td>{row.notas.BIMESTRE_1 ?? "—"}</td>
                    <td>{row.notas.BIMESTRE_2 ?? "—"}</td>
                    <td>{row.notas.CUATRIMESTRE_1 ?? "—"}</td>
                    <td>{row.notas.BIMESTRE_3 ?? "—"}</td>
                    <td>{row.notas.BIMESTRE_4 ?? "—"}</td>
                    <td>{row.notas.CUATRIMESTRE_2 ?? "—"}</td>
                    <td>{row.notas.FINAL ?? "—"}</td>
                    <td
                      className={
                        row.notas.FINAL == null ||
                        row.notas.FINAL === "" ||
                        Number(row.notas.FINAL) >= 6
                          ? "grade-remedial-unavailable"
                          : ""
                      }
                    >
                      {row.notas.DICIEMBRE ?? "—"}
                    </td>
                    <td
                      className={
                        row.notas.DICIEMBRE == null ||
                        row.notas.DICIEMBRE === "" ||
                        Number(row.notas.DICIEMBRE) >= 6
                          ? "grade-remedial-unavailable"
                          : ""
                      }
                    >
                      {row.notas.FEBRERO ?? "—"}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openNotaModal(row)}
                        title="Cargar calificaciones generales"
                        aria-label={`Cargar calificaciones generales de ${row.apellido}, ${row.nombre}`}
                      >
                        ✏️
                      </button>{" "}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openIndividualNotesModal(row)}
                        title="Notas individuales por tema"
                        aria-label={`Notas individuales de ${row.apellido}, ${row.nombre}`}
                      >
                        📄
                      </button>
                    </td>
                  </tr>
                ))}

                {!noteRows.length && (
                  <tr>
                    <td colSpan="11">
                      <div className="empty-state">
                        No hay calificaciones para mostrar.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function ConsultaPage({ isAlumno, boletines, alumnos, cursos, pushToast }) {
  const [search, setSearch] = useState("");
  const [filterCurso, setFilterCurso] = useState("");
  const [filterEstado, setFilterEstado] = useState("Activo");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedDni, setSelectedDni] = useState("");
  const [selectedBulletin, setSelectedBulletin] = useState(null);
  const [loadingDni, setLoadingDni] = useState("");
  const pageSize = 50;

  const filteredAlumnos = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-AR");
    return alumnos.filter((alumno) => {
      const name =
        `${alumno.apellido || ""} ${alumno.nombre || ""}`.toLocaleLowerCase(
          "es-AR",
        );
      const searchTerms = term.split(/\s+/).filter(Boolean);
      const matchSearch =
        !term ||
        searchTerms.every((part) => name.includes(part)) ||
        String(alumno.dni).includes(term);
      const matchCurso =
        !filterCurso || String(alumno.id_curso) === filterCurso;
      const matchEstado =
        !filterEstado ||
        String(alumno.estado).toLocaleLowerCase("es-AR") ===
          filterEstado.toLocaleLowerCase("es-AR");
      return matchSearch && matchCurso && matchEstado;
    });
  }, [alumnos, search, filterCurso, filterEstado]);
  const totalPages = Math.max(1, Math.ceil(filteredAlumnos.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const pageAlumnos = filteredAlumnos.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterCurso, filterEstado]);

  async function toggleBulletins(dni) {
    if (selectedDni === dni) {
      setSelectedDni("");
      setSelectedBulletin(null);
      return;
    }
    setSelectedDni(dni);
    setSelectedBulletin(null);
    setLoadingDni(dni);
    try {
      setSelectedBulletin(
        await apiFetch(`/boletines/${encodeURIComponent(dni)}`),
      );
    } catch (error) {
      setSelectedDni("");
      pushToast(error.message, "warn");
    } finally {
      setLoadingDni("");
    }
  }

  if (isAlumno) {
    return (
      <>
        <div className="section-header">
          <div className="section-title">Mis boletines</div>
        </div>
        <BulletinHistory
          bulletin={boletines}
          showStudentName={false}
          onPdfError={(error) => pushToast(error.message, "warn")}
        />
      </>
    );
  }

  return (
    <>
      <div className="section-header">
        <div className="section-title">Boletines</div>
      </div>
      <div className="card">
        <div className="filters">
          <input
            type="search"
            placeholder="Buscar por nombre, apellido o DNI..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            value={filterCurso}
            onChange={(event) => setFilterCurso(event.target.value)}
          >
            <option value="">Todos los cursos</option>
            {cursos.map((curso) => (
              <option key={curso.id_curso} value={curso.id_curso}>
                {curso.anio}° {curso.division}°
                {curso.especialidad && ` — ${curso.especialidad}`}
              </option>
            ))}
          </select>
          <select
            value={filterEstado}
            onChange={(event) => setFilterEstado(event.target.value)}
          >
            <option value="">Todos los estados</option>
            {ESTADOS_ALUMNO.map((estado) => (
              <option key={estado} value={estado}>
                {estado}
              </option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>DNI</th>
                <th>Apellido(s) y nombre(s)</th>
                <th>Curso</th>
                <th>Estado</th>
                <th>Promedio del año</th>
                <th>Promedio general</th>
                <th>Boletines</th>
              </tr>
            </thead>
            <tbody>
              {pageAlumnos.map((alumno) => (
                <tr key={alumno.dni}>
                  <td>{alumno.dni}</td>
                  <td>
                    <strong>
                      {alumno.apellido?.toLocaleUpperCase("es-AR")},{" "}
                      {alumno.nombre}
                    </strong>
                  </td>
                  <td>
                    <span className="badge badge-blue">
                      {alumno.anio
                        ? `${alumno.anio}° ${alumno.division}°${alumno.especialidad ? ` — ${alumno.especialidad}` : ""}`
                        : "—"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`badge ${String(alumno.estado).toLowerCase() === "activo" ? "badge-ok" : "badge-warn"}`}
                    >
                      {alumno.estado}
                    </span>
                  </td>
                  <td>{formatAverage(alumno.promedio_anio)}</td>
                  <td>{formatAverage(alumno.promedio_general)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => toggleBulletins(alumno.dni)}
                      disabled={loadingDni === alumno.dni}
                    >
                      {loadingDni === alumno.dni
                        ? "Cargando…"
                        : selectedDni === alumno.dni
                          ? "Ocultar"
                          : "Ver boletines"}
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredAlumnos.length && (
                <tr>
                  <td colSpan="7">
                    <div className="empty-state">
                      No hay alumnos que coincidan con el filtro.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredAlumnos.length > 0 && (
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            totalItems={filteredAlumnos.length}
            onPageChange={setCurrentPage}
          />
        )}
      </div>
      {selectedDni && (
        <section className="bulletin-detail">
          {selectedBulletin ? (
            <BulletinHistory
              bulletin={selectedBulletin}
              onPdfError={(error) => pushToast(error.message, "warn")}
            />
          ) : (
            <div className="card empty-state">Cargando boletines…</div>
          )}
        </section>
      )}
    </>
  );
}

function formatAverage(value) {
  return value == null || value === "" ? "—" : Number(value).toFixed(2);
}

function BulletinHistory({ bulletin, showStudentName = true, onPdfError }) {
  const cycles = bulletin?.ciclos || [];
  if (!cycles.length)
    return (
      <div className="card empty-state">No hay boletines para mostrar.</div>
    );

  return (
    <div className="bulletin-history">
      {showStudentName && bulletin.nombre && (
        <div className="section-header">
          <div className="section-title">
            Boletines de {bulletin.apellido?.toLocaleUpperCase("es-AR")},{" "}
            {bulletin.nombre}
          </div>
        </div>
      )}
      {bulletin.promedio_general != null && (
        <div className="card bulletin-general-average">
          <strong>Promedio general</strong>
          <span className="badge badge-blue">
            {formatAverage(bulletin.promedio_general)}
          </span>
        </div>
      )}
      {cycles.map((cycle) => (
        <section
          className="card bulletin-cycle"
          key={`${cycle.anio}-${cycle.cursos?.[0]?.id_curso || "sin-curso"}`}
        >
          <div className="bulletin-cycle-heading">
            <h3>Ciclo lectivo {cycle.anio}</h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm bulletin-pdf-button"
              onClick={() => {
                const pdfWindow = window.open("about:blank", "_blank");
                import("./utils/bulletinPdf")
                  .then(({ openBulletinPdf }) =>
                    openBulletinPdf(bulletin, cycle, pdfWindow),
                  )
                  .catch((error) => {
                    pdfWindow?.close();
                    onPdfError?.(error);
                  });
              }}
            >
              Ver en PDF
            </button>
            <span className="badge badge-blue">
              Promedio del año: {formatAverage(cycle.promedio)}
            </span>
          </div>
          {cycle.cursos?.map((curso) => (
            <div className="bulletin-course" key={curso.id_curso}>
              <h4>
                {curso.anio}° {curso.division}°
                {curso.especialidad && ` — ${curso.especialidad}`}
              </h4>
              <div className="table-wrap">
                <table className="bulletin-table">
                  <thead>
                    <tr>
                      <th>Materia</th>
                      {BULLETIN_PERIODS.map(([, label]) => (
                        <th key={label}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {curso.materias?.map((materia) => (
                      <tr key={materia.codigo}>
                        <th scope="row">{materia.nombre}</th>
                        {BULLETIN_PERIODS.map(([period]) => {
                          const grades =
                            materia.notas?.filter(
                              (nota) => nota.tipo_evaluacion === period,
                            ) || [];
                          return (
                            <td key={period}>
                              {grades.length ? (
                                <div className="bulletin-cell-grades">
                                  {grades.map((nota, index) => (
                                    <span
                                      key={nota.id || `${period}-${index}`}
                                      className={`nota-row-val ${Number(nota.calificacion) >= 6 ? "ok" : "warn"}`}
                                      title={nota.tema || undefined}
                                    >
                                      {nota.calificacion}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {!curso.materias?.length && (
                      <tr>
                        <td colSpan={BULLETIN_PERIODS.length + 1}>
                          No hay materias asignadas a este curso.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function NotificacionesPage({ notificaciones, isAlumno }) {
  const groupedStudentNotifications = isAlumno
    ? notificaciones.reduce((groups, item) => {
        const parsedDate = item.fecha ? new Date(item.fecha) : null;
        const year =
          parsedDate && !Number.isNaN(parsedDate.getTime())
            ? String(parsedDate.getFullYear())
            : "Sin año";
        if (!groups.has(year)) groups.set(year, []);
        groups.get(year).push(item);
        return groups;
      }, new Map())
    : null;

  return (
    <>
      <div className="section-header">
        <div className="section-title">Notificaciones y Alertas</div>
      </div>
      <div className="notif-list">
        {isAlumno
          ? [...groupedStudentNotifications].map(([year, items]) => (
              <section className="notif-year-group" key={year}>
                <h3 className="notif-year-heading">{year}</h3>
                {items.map((item) => (
                  <div className="notif-item" key={item.id_notificacion}>
                    <div
                      className={`notif-icon ${getStudentNotificationState(item)}`}
                    >
                      {getStudentNotificationState(item) === "critical"
                        ? "❌"
                        : getStudentNotificationState(item) === "warning"
                          ? "⚠️"
                          : "✅"}
                    </div>
                    <div className="notif-body">
                      <div className="notif-title">{item.titulo}</div>
                      <div className="notif-desc">{item.mensaje}</div>
                      <div className="notif-meta">
                        {item.fecha
                          ? new Date(item.fecha).toLocaleDateString("es-AR")
                          : "Sin fecha"}
                      </div>
                    </div>
                  </div>
                ))}
              </section>
            ))
          : notificaciones.map((item) => (
              <div className="notif-item" key={item.id_nota}>
                <div
                  className={`notif-icon ${item.tipo === "Crítica" ? "warn" : "ok"}`}
                >
                  {item.tipo === "Crítica" ? "⚠️" : "✅"}
                </div>
                <div className="notif-body">
                  <div className="notif-title">
                    {item.apellido}, {item.nombre} — {item.materia}
                  </div>
                  <div className="notif-desc">
                    {item.tipo_evaluacion} · Nota {item.calificacion}
                  </div>
                  <div className="notif-meta">
                    {item.fecha
                      ? new Date(item.fecha).toLocaleDateString("es-AR")
                      : "Sin fecha"}
                  </div>
                </div>
                <span
                  className={`badge ${item.tipo === "Crítica" ? "badge-warn" : "badge-blue"}`}
                >
                  {item.tipo}
                </span>
              </div>
            ))}
        {!notificaciones.length && (
          <div className="empty-state">No hay notificaciones registradas.</div>
        )}
      </div>
    </>
  );
}

function getStudentNotificationState(item) {
  const message = item.mensaje || "";
  const gradeMatch =
    message.match(
      /(?:nota(?: anterior)?|con nota)\s*:?\s*(\d+(?:[.,]\d+)?)/i,
    ) || message.match(/\((\d+(?:[.,]\d+)?)\)/);
  const grade = gradeMatch ? Number(gradeMatch[1].replace(",", ".")) : null;
  const debtMatch = message.match(/adeuda(?:ba)? el tema:\s*(sí|si|no)/i);
  const owesTopic = debtMatch
    ? debtMatch[1].toLocaleLowerCase("es-AR") !== "no"
    : null;

  if (owesTopic === true || (grade != null && grade < 6 && owesTopic !== false))
    return "critical";
  if (grade != null && grade < 6 && owesTopic === false) return "warning";
  return "ok";
}

export default App;
