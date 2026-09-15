# Corpus OsteoRAG — manifiesto de prioridad

Coloca los PDFs en las carpetas correspondientes. El ingest lee:

- `corpus/escuela/*.pdf`
- `corpus/libros/*.pdf`
- `corpus/tesis/*.pdf`

## Prioridad alta (ingestar primero)

### escuela/
Material de escuela / apuntes oficiales (todos los PDFs de esta carpeta).

### libros/
1. **ANATOMÍA FUNCIONAL PARA FISIOTERAPEUTAS.pdf**
2. **latarjet anatomiahumana T1** (Anatomía Humana Latarjet, Tomo 1 — nombre exacto según el archivo local)

## Diferir (no prioritario en MVP)

- Archivos **KT** grandes
- PPTX muy pesados / enormes

## Notas

- Solo PDF en el ingest actual (`scripts/ingest.ts`).
- Los binarios no se versionan (ver `.gitignore`); este manifiesto sí.
- Tras añadir o actualizar PDFs: `npm run ingest`.
