--=====================================================================
--  NOTIFICACIONES
--=====================================================================

local KINDS = { success = true, error = true, info = true, warning = true }

--- Muestra una notificacion del HUD.
--- @param text string
--- @param kind string|nil  success | error | info | warning
--- @param duration number|nil ms
--- @param title string|nil  cabecera opcional
function HUD.Notify(text, kind, duration, title)
    if not Config.Notify.enabled or not text then return end
    kind = KINDS[kind] and kind or 'info'

    HUD.Send('notify', {
        text     = tostring(text),
        kind     = kind,
        title    = title,
        duration = duration or Config.Notify.duration,
        sound    = Config.Notify.sound and HUD.settings.notifySound ~= false,
    })
end

RegisterNetEvent('nexytt_hud:notify', function(text, kind, duration, title)
    HUD.Notify(text, kind, duration, title)
end)

RegisterNetEvent('nexytt_hud:setNeed', function(need, value)
    Bridge.SetNeed(need, value)
end)

exports('Notify', function(text, kind, duration, title)
    HUD.Notify(text, kind, duration, title)
end)

--=====================================================================
--  COMPATIBILIDAD CON NOTIFICACIONES DEL FRAMEWORK
--  Con esto los scripts que ya tenes siguen funcionando y salen con
--  el estilo del HUD sin tocarles una linea.
--=====================================================================

if Config.Notify.overrideFramework then
    -- ESX
    RegisterNetEvent('esx:showNotification', function(msg, notifyType, length)
        local map = { success = 'success', error = 'error', info = 'info' }
        HUD.Notify(msg, map[notifyType] or 'info', length)
    end)

    -- QBCore
    RegisterNetEvent('QBCore:Notify', function(text, notifyType, duration)
        if type(text) == 'table' then
            HUD.Notify(text.text or text.caption or '', notifyType, duration, text.caption)
        else
            local map = { success = 'success', error = 'error', primary = 'info', warning = 'warning' }
            HUD.Notify(text, map[notifyType] or 'info', duration)
        end
    end)
end
