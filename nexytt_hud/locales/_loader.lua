Locales = Locales or {}

--- Devuelve la traduccion de `key` en el idioma de Config.Locale.
--- Acepta argumentos de string.format: L('cruise_on', '80 km/h')
function L(key, ...)
    local dict = Locales[Config.Locale] or Locales['en'] or {}
    local str  = dict[key] or (Locales['en'] and Locales['en'][key]) or key
    if select('#', ...) > 0 then
        local ok, formatted = pcall(string.format, str, ...)
        if ok then return formatted end
    end
    return str
end
