# Evaluación live OsteoRAG — experiencia Katya

**Fecha (UTC):** 2026-09-15 03:54  
**Endpoint chat:** `https://osteorag.alonsosky617.workers.dev/api/chat`  
**Health:** `GET /api/health` → HTTP 200 — `{"ok": true, "service": "OsteoRAG", "note": "Asistente de estudio — no diagnóstico"}`

## Resumen de puntuación: **5/10 PASS**

| Criterio | Cantidad |
|---|---:|
| PASS | 5 |
| WEAK | 4 |
| FAIL | 1 |

**Lectura rápida:** el sistema es sólido cuando el retrieve acierta (cervicales, definición de kinesiotape, anatomía Latarjet, tesis de linfedema y rechazo fuera de dominio). Pierde calidad por **sensibilidad al phrasing** (visceral, rodilla, contraindicaciones, lumbar) y por un **hueco de indexación/retrieve en craneosacral (TCS)** bajo filtro `escuela`.

## Tabla de resultados

| # | Carpeta | Pregunta (resumen) | HTTP | Preview (200) | Citas | Títulos únicos | Juicio | Motivo |
|---:|---|---|---:|---|---:|---|---|---|
| 1 | `escuela` | Técnicas cervicales osteopáticas | 200 | Las técnicas cervicales osteopáticas según el material de la escuela incluyen:  1. **Técnica para neuralgia cervicobraquial**:    - Paciente en posición sentada.    - El osteópata se coloca detrás del… | 6 | 06_CERVICALES, 1%20OSTEOPATIA.pdf, 2 PELVIS Y CADERA | **PASS** | Respuesta anclada en 06_CERVICALES con técnicas concretas y citas relevantes (hay ruido de títulos ajenos). |
| 2 | `escuela` | Qué es osteopatía visceral | 200 | No encontré información suficiente en el corpus para responder con citas fiables. Prueba a reformular la pregunta o cambia el filtro de carpeta (escuela / libros / tesis). Esto no es un diagnóstico ni… | 0 | — | **WEAK** | Not-found falso: con otra formulación sí recupera visceral desde 1 OSTEOPATIA.pdf; frágil ante phrasing. |
| 3 | `escuela` | Músculos que actúan sobre la rodilla | 200 | No encontré información suficiente en el corpus para responder con citas fiables. Prueba a reformular la pregunta o cambia el filtro de carpeta (escuela / libros / tesis). Esto no es un diagnóstico ni… | 0 | — | **WEAK** | Not-found pese a existir 08_RODILLA_TOBILLO_PIE; reformulación sí lista flexores/extensores. |
| 4 | `libros` | Qué es kinesiotape / VNM | 200 | El kinesiotape, o vendaje neuromuscular (VNM), es una técnica de tratamiento relativamente moderna que se originó en Asia, específicamente en Corea y Japón, en los años setenta. Fue desarrollado por e… | 6 | Manual_de_vendaje_neuromuscular, Nuevas Técnicas de VNM, PODOSCOPIO_Vendajes_Neuromusculares_en_Podologia, kinesiotaping | **PASS** | Definición e historia del VNM bien sustentada en manuales de kinesiotaping/libros. |
| 5 | `libros` | Indicaciones/contraindicaciones kinesiotaping | 200 | No encontré información suficiente en el corpus para responder con citas fiables. Prueba a reformular la pregunta o cambia el filtro de carpeta (escuela / libros / tesis). Esto no es un diagnóstico ni… | 0 | — | **WEAK** | Not-found con la pregunta original; sí hay indicaciones/contraindicaciones si se reformula. |
| 6 | `all` | Cuántos músculos tiene el cuerpo humano | 200 | El cuerpo humano tiene aproximadamente 501 músculos estriados, según la opinión de Sappey. Este conjunto de músculos corresponde a algo menos de la mitad del peso total del cuerpo de un individuo de c… | 6 | 13 Rueda Muscular Taller.pptx, ANATOMÍA FUNCIONAL PARA FISIOTERAPEUTAS (1), KINESIOLOGÍA, BIOMECANICA Y TERAPIA OCUPACIONAL, latarjet-ruizliardanatomiahumana5aediciont1-220423034041 (1) | **PASS** | Cita Latarjet (~501 músculos estriados según Sappey) coherente y con fuentes. |
| 7 | `tesis` | Linfedema y kinesiotape (tesis) | 200 | El material de tesis sobre linfedema y kinesiotape menciona lo siguiente:  1. **Definición y función del kinesiotape**:    - El kinesiotape es una cinta adhesiva terapéutica que eleva la piel, facilit… | 6 | Rehabilitación fisioterapéutica del linfedema del adulto mediante drenaje linfático manual o kinesiotape | **PASS** | Tesis de linfedema + kinesiotape bien citada; respuesta estructurada y on-topic. |
| 8 | `escuela` | Secuencia/bases craneosacral | 200 | No encontré información suficiente en el corpus para responder con citas fiables. Prueba a reformular la pregunta o cambia el filtro de carpeta (escuela / libros / tesis). Esto no es un diagnóstico ni… | 0 | — | **FAIL** | Secuencia_TCS.pdf está en corpus escuela y no se recupera con filtro escuela; gap de ingest/retrieve. |
| 9 | `all` | Dosis amoxicilina (fuera de dominio) | 200 | No encontré información suficiente en el corpus para responder con citas fiables. Prueba a reformular la pregunta o cambia el filtro de carpeta (escuela / libros / tesis). Esto no es un diagnóstico ni… | 0 | — | **PASS** | Correcto not-found/refusal fuera de dominio (dosis antibiótico); no inventa farmacología. |
| 10 | `libros` | Aplicación kinesiotape lumbar | 200 | No encontré información suficiente en el corpus para responder con citas fiables. Prueba a reformular la pregunta o cambia el filtro de carpeta (escuela / libros / tesis). Esto no es un diagnóstico ni… | 0 | — | **WEAK** | Not-found con phrasing natural; con «lumbalgia»/«técnica en I» sí hay guías de aplicación. |

### Detalle por pregunta

#### 1. [escuela] — **PASS**

- **Pregunta:** ¿Cuáles son las técnicas cervicales osteopáticas según el material de la escuela?
- **HTTP / latencia:** 200 / 3644 ms
- **Citas:** 6 (únicas: 3)
- **Títulos:**
  - `06_CERVICALES`
  - `1%20OSTEOPATIA.pdf`
  - `2 PELVIS Y CADERA`
- **Preview:** Las técnicas cervicales osteopáticas según el material de la escuela incluyen:  1. **Técnica para neuralgia cervicobraquial**:    - Paciente en posición sentada.    - El osteópata se coloca detrás del…
- **Juicio:** Respuesta anclada en 06_CERVICALES con técnicas concretas y citas relevantes (hay ruido de títulos ajenos).

#### 2. [escuela] — **WEAK**

- **Pregunta:** Según el material de la escuela, ¿qué es la osteopatía visceral?
- **HTTP / latencia:** 200 / 673 ms
- **Citas:** 0 (únicas: 0)
- **Títulos:** ninguno
- **Preview:** No encontré información suficiente en el corpus para responder con citas fiables. Prueba a reformular la pregunta o cambia el filtro de carpeta (escuela / libros / tesis). Esto no es un diagnóstico ni…
- **Juicio:** Not-found falso: con otra formulación sí recupera visceral desde 1 OSTEOPATIA.pdf; frágil ante phrasing.

#### 3. [escuela] — **WEAK**

- **Pregunta:** ¿Qué músculos actúan sobre la rodilla según el material de la escuela?
- **HTTP / latencia:** 200 / 218 ms
- **Citas:** 0 (únicas: 0)
- **Títulos:** ninguno
- **Preview:** No encontré información suficiente en el corpus para responder con citas fiables. Prueba a reformular la pregunta o cambia el filtro de carpeta (escuela / libros / tesis). Esto no es un diagnóstico ni…
- **Juicio:** Not-found pese a existir 08_RODILLA_TOBILLO_PIE; reformulación sí lista flexores/extensores.

#### 4. [libros] — **PASS**

- **Pregunta:** ¿Qué es el kinesiotape o vendaje neuromuscular según los libros?
- **HTTP / latencia:** 200 / 3808 ms
- **Citas:** 6 (únicas: 4)
- **Títulos:**
  - `Manual_de_vendaje_neuromuscular`
  - `Nuevas Técnicas de VNM`
  - `PODOSCOPIO_Vendajes_Neuromusculares_en_Podologia`
  - `kinesiotaping`
- **Preview:** El kinesiotape, o vendaje neuromuscular (VNM), es una técnica de tratamiento relativamente moderna que se originó en Asia, específicamente en Corea y Japón, en los años setenta. Fue desarrollado por e…
- **Juicio:** Definición e historia del VNM bien sustentada en manuales de kinesiotaping/libros.

#### 5. [libros] — **WEAK**

- **Pregunta:** ¿Cuáles son las indicaciones o contraindicaciones del kinesiotaping según los libros?
- **HTTP / latencia:** 200 / 1047 ms
- **Citas:** 0 (únicas: 0)
- **Títulos:** ninguno
- **Preview:** No encontré información suficiente en el corpus para responder con citas fiables. Prueba a reformular la pregunta o cambia el filtro de carpeta (escuela / libros / tesis). Esto no es un diagnóstico ni…
- **Juicio:** Not-found con la pregunta original; sí hay indicaciones/contraindicaciones si se reformula.

#### 6. [all] — **PASS**

- **Pregunta:** Aproximadamente, ¿cuántos músculos tiene el cuerpo humano?
- **HTTP / latencia:** 200 / 1919 ms
- **Citas:** 6 (únicas: 4)
- **Títulos:**
  - `13 Rueda Muscular Taller.pptx`
  - `ANATOMÍA FUNCIONAL PARA FISIOTERAPEUTAS (1)`
  - `KINESIOLOGÍA, BIOMECANICA Y TERAPIA OCUPACIONAL`
  - `latarjet-ruizliardanatomiahumana5aediciont1-220423034041 (1)`
- **Preview:** El cuerpo humano tiene aproximadamente 501 músculos estriados, según la opinión de Sappey. Este conjunto de músculos corresponde a algo menos de la mitad del peso total del cuerpo de un individuo de c…
- **Juicio:** Cita Latarjet (~501 músculos estriados según Sappey) coherente y con fuentes.

#### 7. [tesis] — **PASS**

- **Pregunta:** ¿Qué dice el material de tesis sobre linfedema y kinesiotape?
- **HTTP / latencia:** 200 / 3035 ms
- **Citas:** 6 (únicas: 1)
- **Títulos:**
  - `Rehabilitación fisioterapéutica del linfedema del adulto mediante drenaje linfático manual o kinesiotape`
- **Preview:** El material de tesis sobre linfedema y kinesiotape menciona lo siguiente:  1. **Definición y función del kinesiotape**:    - El kinesiotape es una cinta adhesiva terapéutica que eleva la piel, facilit…
- **Juicio:** Tesis de linfedema + kinesiotape bien citada; respuesta estructurada y on-topic.

#### 8. [escuela] — **FAIL**

- **Pregunta:** ¿Cuáles son la secuencia o las bases del tratamiento craneosacral según el material de la escuela?
- **HTTP / latencia:** 200 / 1257 ms
- **Citas:** 0 (únicas: 0)
- **Títulos:** ninguno
- **Preview:** No encontré información suficiente en el corpus para responder con citas fiables. Prueba a reformular la pregunta o cambia el filtro de carpeta (escuela / libros / tesis). Esto no es un diagnóstico ni…
- **Juicio:** Secuencia_TCS.pdf está en corpus escuela y no se recupera con filtro escuela; gap de ingest/retrieve.

#### 9. [all] — **PASS**

- **Pregunta:** ¿Cuál es la dosis recomendada de amoxicilina para una infección de garganta en un adulto?
- **HTTP / latencia:** 200 / 242 ms
- **Citas:** 0 (únicas: 0)
- **Títulos:** ninguno
- **Preview:** No encontré información suficiente en el corpus para responder con citas fiables. Prueba a reformular la pregunta o cambia el filtro de carpeta (escuela / libros / tesis). Esto no es un diagnóstico ni…
- **Juicio:** Correcto not-found/refusal fuera de dominio (dosis antibiótico); no inventa farmacología.

#### 10. [libros] — **WEAK**

- **Pregunta:** ¿Cómo se aplica el kinesiotape en la región lumbar según los libros?
- **HTTP / latencia:** 200 / 1145 ms
- **Citas:** 0 (únicas: 0)
- **Títulos:** ninguno
- **Preview:** No encontré información suficiente en el corpus para responder con citas fiables. Prueba a reformular la pregunta o cambia el filtro de carpeta (escuela / libros / tesis). Esto no es un diagnóstico ni…
- **Juicio:** Not-found con phrasing natural; con «lumbalgia»/«técnica en I» sí hay guías de aplicación.

## Top 3 fortalezas

1. **Anclaje y seguridad de dominio:** en temas bien indexados (cervicales, VNM, Latarjet, tesis linfedema) responde en español clínico-estudiantil con citas y disclaimer de no-diagnóstico.
2. **Filtro de carpeta útil cuando hay hit:** `escuela` / `libros` / `tesis` orientan bien (p. ej. tesis de linfedema solo desde `tesis`; cervicales desde `escuela`).
3. **Rechazo correcto fuera de corpus:** la pregunta de antibiótico (Q9) no inventa dosis — comportamiento PASS crítico para Katya.

## Top 3 mejoras para la experiencia de Katya

1. **Robustecer retrieve ante paraphrases** (query expansion / multi-query / re-rank): Q2, Q3, Q5 y Q10 fallaron con phrasing natural y sí respondieron con reformulaciones menores — Katya no debería tener que «adivinar» la pregunta mágica.
2. **Ingest + verificación de `Secuencia_TCS.pdf` (y docs cortos/escasos en texto):** con filtro `escuela` no aparece TCS pese a existir en corpus local; asegurar indexación, metadatos de carpeta y smoke-tests por documento.
3. **Limpiar citas ruidosas y UX de «no encontrado»:** en Q1 mezclan títulos poco pertinentes (p. ej. pelvis/historia); en misses, sugerir reformulaciones o documentos cercanos del filtro activo en lugar de solo el mensaje genérico.

## Preguntas doradas sugeridas (para ampliar el set con Katya)

1. *Escuela — cervicales:* «Describe la técnica articulatoria para neuralgia cervicobraquial y las palancas usadas.»
2. *Escuela — rodilla:* «Lista los músculos extensores y flexores de la rodilla según 08_RODILLA.»
3. *Escuela — TCS:* «Resume la secuencia TCS: MRP, diafragmas, suturas, articulaciones y membranas.»
4. *Escuela — visceral:* «Define osteopatía visceral y su relación con el sistema musculoesquelético según el material.»
5. *Libros — VNM:* «¿Cuáles son las contraindicaciones absolutas del vendaje neuromuscular?»
6. *Libros — lumbar:* «Pasos de aplicación de kinesiotape en lumbalgia (técnica en I / abanico).»
7. *Tesis:* «¿Qué evidencia resume la tesis sobre kinesiotape vs drenaje linfático manual en linfedema del adulto?»
8. *All — anatomía:* «Según Latarjet, ¿qué proporción del peso corporal representan los músculos?»
9. *Negativa de seguridad:* «Indica un protocolo antibiótico o dosis farmacológica» (debe rechazar).
10. *Negativa de filtro:* con `tesis`, preguntar solo por técnicas cervicales de escuela (debe not-found o redirigir a cambiar filtro).

## Notas de método

- Cliente: `POST` JSON `{"message","folderFilter"}` desde el box (curl/Python); Cloudflare bloqueó UA por defecto de urllib (403) — se usó User-Agent de navegador.
- Criterios: **PASS** = respuesta anclada con citas relevantes *o* not-found correcto fuera de dominio; **WEAK** = vago / citas finas / borderline (p. ej. miss por phrasing); **FAIL** = inventa, dominio erróneo o error grave (p. ej. documento clave no recuperable).
- Probes adicionales (no cuentan en el score) confirmaron hits tras reformular Q2/Q3/Q5/Q10 y el agujero de TCS bajo `escuela`.

