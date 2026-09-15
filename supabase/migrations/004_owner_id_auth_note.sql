-- Nota / plantilla: remapear owner_id legado 'katya' → uuid de auth.users.
-- No se aplica automáticamente (sustituye el UUID). Ejecutar a mano si hace falta.
--
-- UPDATE public.conversations
-- SET owner_id = '8c889d3e-3a44-4de7-b688-6540e78d7766'
-- WHERE owner_id = 'katya';
--
-- (En este proyecto, al momento del cambio a Auth no había filas legacy.)

SELECT 1;
