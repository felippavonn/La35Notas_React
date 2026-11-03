import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import shieldImage from "../assets/escudo.png";
import cityShieldImage from "../assets/escudoCABA.png";

const periods = [
  ["BIMESTRE_1", "1° Bimestre"],
  ["BIMESTRE_2", "2° Bimestre"],
  ["CUATRIMESTRE_1", "FINAL"],
  ["BIMESTRE_3", "3° Bimestre"],
  ["BIMESTRE_4", "4° Bimestre"],
  ["CUATRIMESTRE_2", "FINAL"],
  ["FINAL", "1° Cierre"],
  ["DICIEMBRE", "2° Cierre"],
  ["FEBRERO", "3° Cierre"],
];

const closurePeriods = ["FEBRERO", "DICIEMBRE", "FINAL"];

// --------------------------------------------------
// CARGAR IMAGEN
// --------------------------------------------------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`No se pudo cargar la imagen: ${src}`));

    image.src = src;
  });
}

// --------------------------------------------------
// FUNCIONES DE CALIFICACIONES
// --------------------------------------------------

function displayGrade(value) {
  return value == null || value === "" ? "" : String(Number(value));
}

function gradeForPeriod(subject, period) {
  return displayGrade(
    subject.notas?.find(
      (grade) => grade.tipo_evaluacion === period,
    )?.calificacion,
  );
}

function definitiveGrade(subject) {
  for (const period of closurePeriods) {
    const grade = subject.notas?.find(
      (note) => note.tipo_evaluacion === period,
    )?.calificacion;

    if (grade != null && grade !== "") {
      return displayGrade(grade);
    }
  }

  return "";
}

// --------------------------------------------------
// GENERAR DOCUMENTO PDF
// --------------------------------------------------

export async function createBulletinPdfDocument(student, cycle) {
  const course = cycle.cursos?.[0];
  const subjects = course?.materias || [];

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const left = 8;
  const right = pageWidth - 8;
  const contentWidth = right - left;
  const center = pageWidth / 2;

  pdf.setProperties({
    title: `Informe anual ${cycle.anio} - ${student.apellido || ""}, ${student.nombre || ""}`,
    subject: "Boletín escolar",
  });

  // --------------------------------------------------
  // CONFIGURACIÓN GENERAL
  // --------------------------------------------------

  pdf.setDrawColor(65, 65, 65);
  pdf.setTextColor(35, 35, 35);
  pdf.setLineWidth(0.3);

  // Marco exterior centrado verticalmente
  const frameHeight = 181;
  const frameTop = (pageHeight - frameHeight) / 2;
  const frameBottom = frameTop + frameHeight;

  // Desplazamiento respecto de las posiciones originales
  const verticalOffset = frameTop - 7;

  pdf.rect(left, frameTop, contentWidth, frameHeight);

  // Margen interior de los cuadros
  const innerMargin = 2;
  const innerLeft = left + innerMargin;
  const innerRight = right - innerMargin;
  const innerWidth = innerRight - innerLeft;

  // --------------------------------------------------
  // ENCABEZADO INSTITUCIONAL
  // --------------------------------------------------

  // Escudo de la escuela
  try {
    const shield = await loadImage(shieldImage);

    pdf.addImage(
      shield,
      "PNG",
      11,
      12 + verticalOffset,
      29,
      34,
    );
  } catch (error) {
    console.warn("No se pudo cargar el escudo:", error);
  }

  // Escudo del Gobierno de la Ciudad
  try {
    const cityShield = await loadImage(cityShieldImage);

    pdf.addImage(
      cityShield,
      "PNG",
      center - 9,
      9 + verticalOffset,
      18,
      20,
    );
  } catch (error) {
    console.warn("No se pudo cargar el escudo de CABA:", error);
  }

  // Información institucional
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);

  pdf.text(
    "GOBIERNO DE LA CIUDAD AUTONOMA DE BUENOS AIRES",
    center,
    33 + verticalOffset,
    { align: "center" },
  );

  pdf.setFontSize(9);

  pdf.text(
    'E. T. N° 35 D.E. N° 18 "Ing. Eduardo Latzina"',
    center,
    39 + verticalOffset,
    { align: "center" },
  );

  pdf.setFontSize(8);

  pdf.text(
    "Av. Lope de Vega 2150 — CABA",
    center,
    44 + verticalOffset,
    { align: "center" },
  );

  pdf.text(
    "Tel.: 4567-5838/1441 — Mail: det_35_de18@bue.edu.ar",
    center,
    48 + verticalOffset,
    { align: "center" },
  );

  // Línea inferior del encabezado institucional
  pdf.setDrawColor(65, 65, 65);
  pdf.setLineWidth(1);

  pdf.line(
    left,
    52 + verticalOffset,
    right,
    52 + verticalOffset,
  );

  // --------------------------------------------------
  // TÍTULO DEL BOLETÍN
  // --------------------------------------------------

  pdf.setFillColor(225, 225, 225);
  pdf.setDrawColor(65, 65, 65);
  pdf.setLineWidth(0.6);

  pdf.rect(
    innerLeft,
    54 + verticalOffset,
    innerWidth,
    10,
    "FD",
  );

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);

  pdf.text(
    `INFORME ANUAL ${cycle.anio}`,
    center,
    61 + verticalOffset,
    { align: "center" },
  );

  // --------------------------------------------------
  // DATOS DEL ALUMNO
  // --------------------------------------------------

  const studentY = 69 + verticalOffset;

  // Apellido y nombre
  pdf.setDrawColor(100, 100, 100);
  pdf.setLineWidth(0.3);

  pdf.rect(19, studentY, 116, 11);
  pdf.line(50, studentY, 50, studentY + 11);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);

  pdf.text("ALUMNO/A:", 25, studentY + 7);

  const studentName = [
    (student.apellido || "").toUpperCase(),
    student.nombre || "",
  ]
    .filter(Boolean)
    .join(", ");

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);

  pdf.text(
    studentName,
    55,
    studentY + 7,
    { maxWidth: 77 },
  );

  // --------------------------------------------------
  // AÑO, DIVISIÓN Y ESPECIALIDAD
  // --------------------------------------------------

  const infoX = 231;
  const infoY = 68 + verticalOffset;
  const infoWidth = 34;
  const infoRowHeight = 5.5;
  const labelWidth = 14;

  const studentInfo = [
    ["AÑO:", course?.anio == null ? "" : `${course.anio}°`],
    ["DIVISIÓN:", course?.division == null ? "" : `${course.division}°`],
  ];
    
  if (Number(course?.anio) >= 3) {
    studentInfo.push([
      "",
      (course?.especialidad || "").toUpperCase(),
    ]);
  }

  studentInfo.forEach((item, index) => {
    const y = infoY + index * infoRowHeight;

    pdf.rect(infoX, y, infoWidth, infoRowHeight);

    if (index < 2) {
      pdf.line(
        infoX + labelWidth,
        y,
        infoX + labelWidth,
        y + infoRowHeight,
      );
    }

    // Etiquetas
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);

    if (item[0]) {
      pdf.text(
        item[0],
        infoX + 1,
        y + 3.7,
      );
    }

    // Valores centrados
    pdf.setFont(
      "helvetica",
      index === 2 ? "bold" : "normal",
    );

    pdf.setFontSize(7);

    pdf.text(
      item[1],
      index === 2
        ? infoX + infoWidth / 2
        : infoX + labelWidth + (infoWidth - labelWidth) / 2,
      y + 3.7,
      {
        align: "center",
        maxWidth: index === 2 ? 32 : 19,
      },
    );
  });

  // --------------------------------------------------
  // TABLA DE CALIFICACIONES
  // --------------------------------------------------

  const gradesStartY = 87 + verticalOffset;

  const gradeHeaders = [
    "",
    "ASIGNATURA",
    ...periods.map(([, label]) => label),
    "Calif. Def.",
  ];

  const gradeRows = subjects.map((subject, index) => [
    String(index + 1),
    subject.nombre || "",
    ...periods.map(([period]) =>
      gradeForPeriod(subject, period),
    ),
    definitiveGrade(subject),
  ]);

  const emptyRow = [
    "",
    "",
    ...periods.map(() => ""),
    "",
  ];

  autoTable(pdf, {
    startY: gradesStartY,

    margin: {
      left: innerLeft,
      right: pageWidth - innerRight,
      bottom: 15,
    },

    tableWidth: innerWidth,

    head: [gradeHeaders],

    body: [
      ...(gradeRows.length
        ? gradeRows
        : [["", "", ...periods.map(() => ""), ""]]),
      emptyRow,
    ],

    theme: "grid",

    styles: {
      font: "helvetica",
      fontSize: 6.5,
      textColor: 35,
      lineColor: 65,
      lineWidth: 0.2,
      cellPadding: 1,
      minCellHeight: 4.7,
      overflow: "linebreak",
      valign: "middle",
    },

    headStyles: {
      fillColor: [225, 225, 225],
      textColor: 35,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      minCellHeight: 6,
    },

    columnStyles: {
      0: {
        cellWidth: 9,
        halign: "center",
      },

      1: {
        cellWidth: 90,
        halign: "left",
      },

      // Diez columnas de períodos y calificación definitiva.
      // Se redujeron para que la tabla entre en el recuadro.
      ...Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          index + 2,
          {
            cellWidth: 17.8,
            halign: "center",
          },
        ]),
      ),
    },

    didParseCell(data) {
      const isEmptyRow =
        data.section === "body" &&
        data.row.index === (gradeRows.length || 1);
    
      if (isEmptyRow) {
        data.cell.styles.fillColor = [225, 225, 225];
        data.cell.styles.minCellHeight = 5;
    
        data.cell.styles.lineWidth = {
          top: 0.2,
          bottom: 0.2,
          left: 0,
          right: 0,
        };
    
        if (data.column.index === 0) {
          data.cell.styles.lineWidth.left = 0.2;
        }
    
        if (data.column.index === gradeHeaders.length - 1) {
          data.cell.styles.lineWidth.right = 0.2;
        }
      }
    },

    rowPageBreak: "avoid",
    pageBreak: "avoid",
  });

  // Línea inferior de la tabla
  const gradesEndY = pdf.lastAutoTable.finalY;

  pdf.setDrawColor(65, 65, 65);
  pdf.setLineWidth(0.2);

  pdf.line(
    innerLeft,
    gradesEndY,
    innerRight,
    gradesEndY,
  );

  // --------------------------------------------------
  // VALORACIONES BIMESTRALES
  // --------------------------------------------------

  const footerY = frameBottom - 33;
  const footerX = 10;
  const footerWidth = 175;
  const footerHeight = 32;

  pdf.setDrawColor(65, 65, 65);
  pdf.setLineWidth(0.3);

  pdf.rect(
    footerX,
    footerY,
    footerWidth,
    footerHeight,
  );

  // Encabezado
  pdf.setFillColor(225, 225, 225);

  pdf.rect(
    footerX,
    footerY,
    footerWidth,
    5,
    "FD",
  );

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7.5);

  pdf.text(
    "VALORACIONES BIMESTRALES RESPECTO DE LOS OBJETIVOS",
    footerX + footerWidth / 2,
    footerY + 3.5,
    { align: "center" },
  );

  // EP
  let currentY = footerY + 5;

  pdf.setFontSize(5.5);
  pdf.setFont("helvetica", "bold");

  pdf.text(
    "EP:",
    footerX + 1.5,
    currentY + 3,
  );

  pdf.setFont("helvetica", "normal");

  const epText =
    "El estudiante está empezando a desarrollar los aprendizajes previstos o evidencia algunas dificultades para el desarrollo de estos y necesita mayor tiempo de acompañamiento e intervención docente.";

  const epLines = pdf.splitTextToSize(
    epText,
    footerWidth - 14,
  );

  pdf.text(
    epLines.slice(0, 2),
    footerX + 11,
    currentY + 2.7,
    { lineHeightFactor: 1.1 },
  );

  currentY += 8;

  pdf.line(
    footerX,
    currentY,
    footerX + footerWidth,
    currentY,
  );

  // NC
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6.3);

  pdf.text(
    "NC:",
    footerX + 1.5,
    currentY + 4,
  );

  pdf.setFont("helvetica", "normal");

  pdf.text(
    '"No Corresponde" El estudiante se encuentra en situación Pedagógica o Administrativa por la cual no corresponde calificar.',
    footerX + 11,
    currentY + 4,
    { maxWidth: footerWidth - 13 },
  );

  currentY += 6;

  pdf.line(
    footerX,
    currentY,
    footerX + footerWidth,
    currentY,
  );

  // NI
  pdf.setFont("helvetica", "bold");

  pdf.text(
    "NI:",
    footerX + 1.5,
    currentY + 3.5,
  );

  pdf.setFont("helvetica", "normal");

  pdf.text(
    "El estudiante No inició su trayectoria.",
    footerX + 11,
    currentY + 3.5,
  );

  currentY += 5;

  pdf.line(
    footerX,
    currentY,
    footerX + footerWidth,
    currentY,
  );

  // FINALIZADO
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(6.3);

  pdf.text(
    "6-7-8-9-10:",
    footerX + 1.5,
    currentY + 4.5,
  );

  const finalizedLabelX = footerX + 17;

  pdf.text(
    '"FINALIZADO"',
    finalizedLabelX,
    currentY + 4.5,
  );

  const finalizedWidth = pdf.getTextWidth('"FINALIZADO"');

  pdf.setFont("helvetica", "normal");

  pdf.text(
    "El estudiante alcanzó su trayectoria escolar evidenciando el logro de los aprendizajes.",
    finalizedLabelX + finalizedWidth + 1.5,
    currentY + 4.5,
    {
      maxWidth:
        footerWidth -
        (finalizedLabelX - footerX) -
        finalizedWidth -
        2,
    },
  );

  // --------------------------------------------------
  // ESPACIO PARA SELLO DEL ESTABLECIMIENTO
  // --------------------------------------------------

  const sealX = 198;
  const sealY = frameBottom - 34;

  pdf.setDrawColor(110, 110, 110);
  pdf.setLineWidth(0.3);

  pdf.circle(
    sealX + 18,
    sealY + 12,
    12,
  );

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);

  pdf.text(
    "Sello del Establecimiento",
    sealX + 18,
    sealY + 29,
    { align: "center" },
  );

  // --------------------------------------------------
  // ESPACIO PARA FIRMA DE AUTORIDAD
  // --------------------------------------------------

  const signatureX = 240;
  const signatureY = frameBottom - 34;

  pdf.rect(
    signatureX,
    signatureY,
    35,
    24,
  );

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);

  pdf.text(
    "Firma Autoridad",
    signatureX + 17.5,
    signatureY + 29,
    { align: "center" },
  );

  return pdf;
}

// --------------------------------------------------
// ABRIR O DESCARGAR EL PDF
// --------------------------------------------------

export async function openBulletinPdf(student, cycle, pdfWindow) {
  const pdf = await createBulletinPdfDocument(student, cycle);

  const blobUrl = URL.createObjectURL(
    pdf.output("blob"),
  );

  if (pdfWindow) {
    pdfWindow.location.replace(blobUrl);
  } else {
    const link = document.createElement("a");

    link.href = blobUrl;

    link.download = `boletin-${student.dni}-${cycle.anio}.pdf`;

    link.click();
  }

  window.setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 60_000);
}
