import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const periods = [
  ["BIMESTRE_1", "Valoración 1.º bimestre"],
  ["BIMESTRE_2", "Valoración 2.º bimestre"],
  ["CUATRIMESTRE_1", "1.er cuatrimestre"],
  ["BIMESTRE_3", "Valoración 3.º bimestre"],
  ["BIMESTRE_4", "Valoración 4.º bimestre"],
  ["CUATRIMESTRE_2", "2.º cuatrimestre"],
  ["FINAL", "Final"],
  ["DICIEMBRE", "Diciembre"],
  ["FEBRERO", "Febrero"],
];

function displayDate(value) {
  if (!value) return "";
  const date = String(value).slice(0, 10).split("-");
  return date.length === 3 ? `${date[2]}/${date[1]}/${date[0]}` : "";
}

function displayGrade(value) {
  return value == null || value === "" ? "" : String(Number(value));
}

function displayAverage(value) {
  return value == null || value === "" ? "" : Number(value).toFixed(2);
}

function gradeForPeriod(subject, period) {
  return displayGrade(
    subject.notas?.find((grade) => grade.tipo_evaluacion === period)
      ?.calificacion,
  );
}

export function createBulletinPdfDocument(student, cycle) {
  const course = cycle.cursos?.[0];
  const subjects = course?.materias || [];
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const left = 8;
  const right = pageWidth - 8;

  pdf.setProperties({
    title: `Informe anual ${cycle.anio} - ${student.apellido || ""}, ${student.nombre || ""}`,
    subject: "Boletín escolar",
  });

  pdf.setDrawColor(40, 40, 40);
  pdf.setLineWidth(0.25);
  pdf.rect(left, 7, 23, 21);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(`INFORME ANUAL ${cycle.anio}`, pageWidth / 2, 19, {
    align: "center",
  });

  const personalRows = [
    ["APELLIDO", student.apellido || "", "Nombre", student.nombre || ""],
    ["DNI", student.dni || "", "Especialidad", course?.especialidad || ""],
    [
      "Año",
      course?.anio == null ? "" : `${course.anio}°`,
      "División",
      course?.division == null ? "" : `${course.division}°`,
    ],
    [
      "Nacimiento",
      displayDate(student.fecha_nacimiento),
      "Género",
      student.genero || "",
    ],
    [
      "Nacionalidad",
      student.nacionalidad || "",
      "Domicilio",
      student.domicilio || "",
    ],
    [
      "Turno",
      course?.turno || "",
      "Promedio del ciclo",
      displayAverage(cycle.promedio),
    ],
  ];

  autoTable(pdf, {
    startY: 31,
    margin: { left, right: pageWidth - right },
    body: personalRows,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8,
      textColor: 0,
      lineColor: 70,
      lineWidth: 0.15,
      cellPadding: 1.5,
      minCellHeight: 5.5,
    },
    columnStyles: {
      0: { cellWidth: 27, fontStyle: "bold" },
      1: { cellWidth: 112 },
      2: { cellWidth: 27, fontStyle: "bold" },
      3: { cellWidth: 115 },
    },
  });

  const gradeHeaders = [
    "Asignatura",
    ...periods.map(([, label]) => label),
    "Calificación definitiva",
  ];
  const gradeRows = subjects.map((subject) => [
    subject.nombre,
    ...periods.map(([period]) => gradeForPeriod(subject, period)),
    "",
  ]);

  const gradesStartY = pdf.lastAutoTable.finalY + 3;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("CALIFICACIONES", left, gradesStartY + 2);
  autoTable(pdf, {
    startY: gradesStartY + 4,
    margin: { left, right: pageWidth - right, bottom: 38 },
    head: [gradeHeaders],
    body: gradeRows.length ? gradeRows : [["", ...periods.map(() => ""), ""]],
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 6.5,
      textColor: 0,
      lineColor: 50,
      lineWidth: 0.15,
      cellPadding: 1.1,
      minCellHeight: 5,
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [235, 235, 235],
      textColor: 0,
      fontStyle: "bold",
      halign: "center",
      minCellHeight: 9,
    },
    columnStyles: {
      0: { cellWidth: 53, fontStyle: "bold", halign: "left" },
      ...Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          index + 1,
          { cellWidth: 22.8, halign: "center" },
        ]),
      ),
    },
    rowPageBreak: "avoid",
  });

  pdf.setPage(pdf.internal.getNumberOfPages());
  const sealY = pageHeight - 28;
  pdf.setDrawColor(60, 60, 60);
  pdf.rect(right - 25, sealY, 25, 18);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.text("Sello del establecimiento", right - 12.5, sealY + 22, {
    align: "center",
  });

  return pdf;
}

export function openBulletinPdf(student, cycle, pdfWindow) {
  const pdf = createBulletinPdfDocument(student, cycle);
  const blobUrl = URL.createObjectURL(pdf.output("blob"));
  if (pdfWindow) {
    pdfWindow.location.replace(blobUrl);
  } else {
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `boletin-${student.dni}-${cycle.anio}.pdf`;
    link.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
