--=====================================================================
--  BRIDGE DE FRAMEWORK (servidor)
--  Solo lo que el HUD necesita del lado servidor: identificar el
--  framework y poder empujar notificaciones a un jugador concreto.
--=====================================================================

SvBridge = { name = 'standalone', core = nil }

local function started(res)
    return res and res ~= '' and GetResourceState(res) == 'started'
end

CreateThread(function()
    Wait(500)

    local fw = Config.Framework
    if fw == 'auto' then
        if     started(Config.Resources.esx) then fw = 'esx'
        elseif started(Config.Resources.qbx) then fw = 'qbx'
        elseif started(Config.Resources.qb)  then fw = 'qb'
        else   fw = 'standalone' end
    end

    if fw == 'esx' then
        local ok, obj = pcall(function() return exports[Config.Resources.esx]:getSharedObject() end)
        if ok and obj then SvBridge.core = obj end
    elseif fw == 'qb' then
        local ok, obj = pcall(function() return exports[Config.Resources.qb]:GetCoreObject() end)
        if ok and obj then SvBridge.core = obj end
    end

    SvBridge.name = fw

    if Config.Debug then
        print(('[nexytt_hud] servidor: framework = %s'):format(fw))
    end
end)

--- Envia una notificacion del HUD a un jugador.
--- @param src number  id del jugador
--- @param text string texto
--- @param kind string  success | error | info | warning
--- @param duration number|nil ms
function SvBridge.Notify(src, text, kind, duration)
    TriggerClientEvent('nexytt_hud:notify', src, text, kind, duration)
end

-- El export publico Notify vive en server/main.lua para no duplicarlo.
exports('GetFramework', function() return SvBridge.name end)
