--=====================================================================
--  SERVIDOR
--  Cuenta de jugadores online y utilidades expuestas a otros scripts.
--=====================================================================

local playerCount = 0
local maxPlayers  = GetConvarInt('sv_maxclients', 48)

local function refreshCount()
    local n = #GetPlayers()
    if n ~= playerCount then
        playerCount = n
        TriggerClientEvent('nexytt_hud:playerCount', -1, playerCount, maxPlayers)
    end
end

AddEventHandler('playerJoining',  function() SetTimeout(500, refreshCount) end)
AddEventHandler('playerDropped',  function() SetTimeout(500, refreshCount) end)

CreateThread(function()
    while true do
        Wait(15000)
        refreshCount()
    end
end)

-- El cliente pide el estado inicial en cuanto arranca su HUD
RegisterNetEvent('nexytt_hud:requestSync', function()
    local src = source
    playerCount = #GetPlayers()
    TriggerClientEvent('nexytt_hud:playerCount', src, playerCount, maxPlayers)
end)

--=====================================================================
--  EXPORTS PARA OTROS RESOURCES
--=====================================================================

--- exports['nexytt_hud']:Notify(source, 'Texto', 'success', 5000)
exports('Notify', function(src, text, kind, duration)
    TriggerClientEvent('nexytt_hud:notify', src, text, kind, duration)
end)

--- exports['nexytt_hud']:NotifyAll('Reinicio en 5 minutos', 'warning')
exports('NotifyAll', function(text, kind, duration)
    TriggerClientEvent('nexytt_hud:notify', -1, text, kind, duration)
end)

--- exports['nexytt_hud']:SetNeed(source, 'hunger', 42.0)
exports('SetNeed', function(src, need, value)
    TriggerClientEvent('nexytt_hud:setNeed', src, need, value)
end)

--- exports['nexytt_hud']:GetPlayerCount()
exports('GetPlayerCount', function()
    return #GetPlayers(), maxPlayers
end)
