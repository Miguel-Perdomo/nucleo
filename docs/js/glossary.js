/**
 * glossary.js — Explica en lenguaje sencillo las expresiones técnicas que
 * aparecen en los nombres oficiales de la CIE-10.
 * Cada entrada: [expresión regular, término, explicación].
 */
export const GLOSSARY = [
  [/\bno especificad[oa]s?\b|\bsin otra especificaci[oó]n\b|\btipo no especificado\b|\bparte no especificada\b|\bsitio no especificado\b/i,
    "No especificada",
    "El médico no registró un subtipo más detallado. No significa que la enfermedad sea desconocida ni más grave; es una forma de clasificación."],
  [/\bno clasificad[oa]s? en otra parte\b/i,
    "No clasificada en otra parte",
    "Una regla de clasificación: la condición no encaja en un grupo más específico de la CIE-10."],
  [/\bsin menci[oó]n de complicaci[oó]n\b|\bsin complicaci[oó]n\b/i,
    "Sin complicación",
    "En el momento del registro no se anotaron complicaciones asociadas."],
  [/\bagud[oa]s?\b/i,
    "Agudo",
    "De aparición reciente o de corta duración. No quiere decir “grave”."],
  [/\bcr[oó]nic[oa]s?\b/i,
    "Crónico",
    "Que dura mucho tiempo o es de larga evolución; suele requerir seguimiento."],
  [/\besencial\b|\bprimaria\b/i,
    "Esencial (primaria)",
    "No se debe a otra enfermedad identificable; es la forma más común."],
  [/\bmaligno\b/i,
    "Tumor maligno",
    "Es el término técnico para cáncer: células que crecen sin control y pueden invadir otros tejidos."],
  [/\bbenign[oa]\b/i,
    "Benigno",
    "No es canceroso y no se disemina a otras partes del cuerpo."],
  [/\bpresunto origen infeccioso\b/i,
    "De presunto origen infeccioso",
    "Se sospecha que la causa es una infección, aunque no siempre se confirma con exámenes."],
  [/\binsulinodependiente\b/i,
    "Insulinodependiente",
    "Clasificación antigua: “insulinodependiente” corresponde a la diabetes tipo 1 y “no insulinodependiente” a la tipo 2."],
  [/\bsenil\b/i,
    "Senil",
    "Relacionado con la edad avanzada. Es un término descriptivo, no peyorativo."],
  [/\bcong[eé]nit[oa]s?\b/i,
    "Congénito",
    "Presente desde el nacimiento."],
  [/\bidiop[aá]tic[oa]\b/i,
    "Idiopático",
    "De causa desconocida."],
  [/\bsupervisi[oó]n\b|\bexamen\b|\bconsulta\b|\bconsejo\b/i,
    "Código de atención",
    "Este código registra el motivo de la consulta (un control, examen o asesoría), no necesariamente una enfermedad."],
];

/** Devuelve las explicaciones que aplican a un nombre oficial. */
export function explainTitle(title) {
  return GLOSSARY.filter(([re]) => re.test(title)).map(([, term, text]) => ({ term, text }));
}
