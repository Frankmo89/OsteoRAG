# Fuentes abiertas — OsteoRAG (evidencia legal)

Última actualización: 2026-09-15 (agente box).  
Carpeta de PDFs: `corpus/libros/evidencia/` (gitignored).  
**No** incluir libros cerrados / paywalled / captcha-blocked sin descarga manual del usuario.

## Ya ingeridos (Supabase)

| Fuente | Archivo / título | Chunks (aprox.) | Notas |
|--------|------------------|-----------------|-------|
| CENETEC IMSS-045-08 Lumbalgia | `CENETEC_IMSS-045-08_Lumbalgia_EVR.pdf` | 123 | Guía abierta MX |
| MSP Ecuador Guía Dolor Lumbar 2016 | `MSP_Ecuador_Guia_Dolor_Lumbar_2016.pdf` | 146 | Guía abierta |
| OMS/EOTS formación osteopatía (trad.) | `OMS_formacion_osteopatia_traduccion_EOTS.pdf` | 46 | Benchmarks / formación |
| SciELO masaje ansiedad/estrés niños | `SciELO_Masaje_ansiedad_estres_ninos.pdf` | 33 | Full text ya en corpus |
| SciELO masaje niños cáncer | `SciELO_Masaje_ninos_cancer.pdf` | 39 | Full text ya en corpus |

## Descargados en esta sesión (listos para ingest; **aún no ingeridos**)

Guardados en box: `/workspace/OsteoRAG/corpus/libros/evidencia/`.  
Pendiente copia a Windows: `C:\Users\katya\Documents\alonso\OsteoRAG\corpus\libros\evidencia\` (esta caja no tiene montaje del PC `c4a6fce1-…`).

| Fuente | Archivo local | Origen legal | Estado |
|--------|---------------|--------------|--------|
| **FOE** Evidencia y Osteopatía 2019 | `FOE_Evidencia_y_Osteopatia_2019.pdf` | Wayback Machine de `osteopatas.org` (PDF público histórico) | **OK PDF** — listo ingest |
| **PMC / visceral** Guillaud 2018 SR | `PMC_Visceral_osteopathy_SR_2018_Guillaud.pdf` | CC BY; espejo DNB `d-nb.info/1155711009/34` (BMC/PMC anti-bot) | **OK PDF** — listo ingest |
| **PMC / visceral** fascial therapy SR 2023 | `PMC_Visceral_fascial_therapy_SR_2023.pdf` | CC BY; espejo DNB `d-nb.info/1308085745/34` | **OK PDF** — listo ingest |
| **OPERA** España 2020 | `OPERA_Spain_PLOS_2020.pdf` | PLOS ONE CC BY (evita PMC) | **OK PDF** — listo ingest |
| **OPERA** Austria 2022 | `OPERA_Austria_PLOS_2022.pdf` | PLOS ONE CC BY | **OK PDF** — listo ingest |
| **OPERA** Italia 2019 | `OPERA_Italy_PLOS_2019.pdf` | PLOS ONE CC BY | **OK PDF** — listo ingest |
| **LibreTexts** Evidence-Based Massage Therapy (Lebert) | `LibreTexts_Evidence_Based_Massage_Therapy_Lebert.pdf` | OER LibreTexts batch PDF | **OK PDF** — listo ingest |
| **RediUMH** Roura Carvajal (Body Adjustment / lumbalgia) | `RediUMH_Roura_Carvajal_Sonia_BodyAdjustment_lumbalgia.pdf` | `dspace.umh.es` open | **OK PDF** — listo ingest |
| **RediUMH** Parera Turull (manipulación cervical / latigazo) | `RediUMH_Parera_Turull_Joan_manipulacion_cervical.pdf` | `dspace.umh.es` open | **OK PDF** — listo ingest |
| **RediUMH** Ularu Adelina (discrepancia MMII / postura) | `RediUMH_Ularu_Adelina.pdf` | `dspace.umh.es` open; TFG podología (adyacente MSK) | **OK PDF** — opcional |
| Bonus OEGO overview SRs 2025 | `OEGO_Overview_SRs_Osteopathy_2025.pdf` | oego.org / CC BY | **OK PDF** — listo ingest |
| Bonus PLOS osteopathic spinal 2018 | `PLOS_Osteopathic_spinal_complaints_2018.pdf` | PLOS ONE CC BY | **OK PDF** — listo ingest |

### Comando ingest (cuando haya `.env` con claves)

En el PC Windows (recomendado; aquí no hay `OPENAI_API_KEY` ni `SUPABASE_SERVICE_ROLE_KEY`):

```bat
cd C:\Users\katya\Documents\alonso\OsteoRAG
npm run reingest-one -- corpus/libros/evidencia/FOE_Evidencia_y_Osteopatia_2019.pdf
npm run reingest-one -- corpus/libros/evidencia/PMC_Visceral_osteopathy_SR_2018_Guillaud.pdf
npm run reingest-one -- corpus/libros/evidencia/PMC_Visceral_fascial_therapy_SR_2023.pdf
npm run reingest-one -- corpus/libros/evidencia/OPERA_Spain_PLOS_2020.pdf
npm run reingest-one -- corpus/libros/evidencia/OPERA_Austria_PLOS_2022.pdf
npm run reingest-one -- corpus/libros/evidencia/OPERA_Italy_PLOS_2019.pdf
npm run reingest-one -- corpus/libros/evidencia/LibreTexts_Evidence_Based_Massage_Therapy_Lebert.pdf
npm run reingest-one -- corpus/libros/evidencia/RediUMH_Roura_Carvajal_Sonia_BodyAdjustment_lumbalgia.pdf
npm run reingest-one -- corpus/libros/evidencia/RediUMH_Parera_Turull_Joan_manipulacion_cervical.pdf
npm run reingest-one -- corpus/libros/evidencia/OEGO_Overview_SRs_Osteopathy_2025.pdf
npm run reingest-one -- corpus/libros/evidencia/PLOS_Osteopathic_spinal_complaints_2018.pdf
```

Respetar rate limits OpenAI (pausas entre archivos grandes: LibreTexts ~9.6 MB, tesis UMH ~13–15 MB).

## Manual / bloqueado (no forzar)

| Fuente | Motivo | Acción humana |
|--------|--------|---------------|
| **FOE Evidencia 2021** | Solo miembros MROE en `osteopatas.org`; HTML en FOE no es PDF; sitio vivo 404 en ficheros antiguos | Descargar con credenciales MROE o desde área miembros FOE; guardar como `FOE_Evidencia_y_Osteopatia_2021.pdf` |
| **PMC PDF directo / BMC counter** | Anti-bot (HTML challenge / 429 EuropePMC) | Usar espejos DNB ya bajados; si hace falta otro PMC, abrir en navegador humano y Guardar PDF |
| **SciELO “solo abstract”** | Algunos ítems SciELO no ofrecen full text PDF | Los dos papers de masaje infantil **ya están full-text e ingeridos**; no ampliar con abstracts-only. Si aparece otro SciELO abstract-only, documentar DOI y omitir o pegar solo abstract con licencia clara |
| **Libros cerrados** (Barral, Latarjet comercial, etc.) | Copyright | **No** añadir; ya hay Latarjet/funcional en corpus usuario — fuera de este pipeline abierto |

## URLs de referencia (legales)

- FOE docs index: https://www.federacionosteopatas.es/main.asp?Familia=217  
- FOE 2019 (histórico): Wayback → `…/ROE_EVIDENCIA_Y_OSTEOPATIA_2019.pdf`  
- OPERA ES: https://doi.org/10.1371/journal.pone.0234713  
- OPERA AT: https://doi.org/10.1371/journal.pone.0278041  
- OPERA IT: https://doi.org/10.1371/journal.pone.0211353  
- Visceral SR 2018: https://doi.org/10.1186/s12906-018-2098-8  
- Visceral fascial SR 2023: https://doi.org/10.1186/s12906-023-04099-1  
- LibreTexts: https://med.libretexts.org/Bookshelves/Allied_Health/Evidence-Based_Massage_Therapy_(Lebert)  
- RediUMH / dspace.umh.es bitstream (Roura, Parera, Ularu)

## Política

1. Solo fuentes abiertas (CC BY, OER institucional, guías oficiales, repositorios universitarios).  
2. No paywalls, no CAPTCHA bypass, no piratería.  
3. PDFs grandes en `corpus/` — **nunca** `git add` de binarios.  
4. No tocar retrieve/auth/UI en este trabajo.
