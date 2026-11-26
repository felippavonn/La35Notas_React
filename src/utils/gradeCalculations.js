const closurePeriods = ["FEBRERO", "DICIEMBRE", "FINAL"];

export function formatGrade(value) {
  return value == null || value === "" ? "" : String(Number(value));
}

export function getDefinitiveGrade(subject) {
  for (const period of closurePeriods) {
    const grade = subject.notas?.find(
      (note) => note.tipo_evaluacion === period,
    )?.calificacion;

    if (grade != null && grade !== "") return formatGrade(grade);
  }

  return "";
}
