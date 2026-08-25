--=====================================================================
--  ORQUESTADOR DEL HUD
--=====================================================================

local server = { players = 0, maxPlayers = 0 }
local cinematic = false

--=====================================================================
--  PANEL DE SERVIDOR
--=====================================================================

local function gameTime()
    return ('%02d:%02d'):format(GetClockHours(), GetClockMinutes())
end

local function realTime()
    local t = os.date('*t')
    return ('%02d:%02d'):format(t.hour, t.min)
end

local function pushServerPanel()
    if not HUD.settings.showServerPanel then
        HUD.Send('server', { visible = false })
        return
    end

    HUD.Send('server', {
        visible    = true,
        name       = Config.Server.name,
        showLogo   = Config.Server.showLogo,
        players    = Config.Server.showPlayers and HUD.settings.showPlayers and server.players or nil,
        maxPlayers = server.maxPlayers,
        id         = Config.Server.showId and GetPlayerServerId(PlayerId()) or nil,
        time       = Config.Server.showTime
                     and (Config.Server.timeSource == 'real' and realTime() or gameTime())
                     or nil,
        job        = Config.Server.showJob and Bridge.GetJobLabel() or nil,
        fps        = (Config.Server.showFps  and HUD.settings.showFps)  and Perf.fps  or nil,
        ping       = (Config.Server.showPing and HUD.settings.showPing) and Perf.ping or nil,
        framework  = Bridge.name,
    })
end

RegisterNetEvent('nexytt_hud:playerCount', function(count, max)
    server.players    = count or 0
    server.maxPlayers = max or 0
    pushServerPanel()
end)

--=====================================================================
--  VISIBILIDAD GLOBAL
--=====================================================================

local function setPaused(state)
    if HUD.paused == state then return end
    HUD.paused = state
    HUD.Send('visible', { visible = HUD.visible and not HUD.paused })
end

CreateThread(function()
    while true do
        setPaused(HUD.ShouldHide())
        Wait(200)
    end
end)

--=====================================================================
--  MODO CINE
--=====================================================================

local function setCinematic(state)
    cinematic = state
    HUD.settings.cinematicBars = state
    HUD.Send('cinematic', { active = state })
    DisplayRadar(not state)
end

CreateThread(function()
    HUD.BindKey(Config.Commands.cinema, 'Modo cine', Config.Keys.cinematic, function()
        setCinematic(not cinematic)
    end)
end)

--=====================================================================
--  ARRANQUE
--=====================================================================

CreateThread(function()
    -- Los ajustes ya se cargaron en settings.lua; esperamos a que la NUI avise.
    local timeout = GetGameTimer() + 15000
    while not HUD.nuiReady and GetGameTimer() < timeout do Wait(100) end

    TriggerServerEvent('nexytt_hud:requestSync')

    HUD.Send('visible', { visible = HUD.visible })
    pushServerPanel()

    Bridge.On('job', function() pushServerPanel() end)
    Bridge.On('loaded', function() pushServerPanel() end)

    while true do
        if HUD.visible and not HUD.paused then
            pushServerPanel()
        end
        -- Con FPS o ping en pantalla el panel tiene que ir al segundo;
        -- si no, con refrescarlo cada pocos segundos sobra.
        local live = HUD.settings.showFps or HUD.settings.showPing
        Wait(live and Config.Tick.slow or Config.Tick.slow * 5)
    end
end)

--=====================================================================
--  LIMPIEZA
--=====================================================================

AddEventHandler('onResourceStop', function(resource)
    if resource ~= GetCurrentResourceName() then return end

    SetNuiFocus(false, false)
    ClearTimecycleModifier()
    DisplayRadar(true)

    local ped = PlayerPedId()
    SetPedConfigFlag(ped, 32, true)
    SetFlyThroughWindscreenParams(17.0, 10.0, 0.0, 0.0)
end)

--=====================================================================
--  EXPORTS DE CONTROL
--=====================================================================

--- exports['nexytt_hud']:SetVisible(false)  -> ocultar el HUD (cinematicas, etc.)
exports('SetVisible', function(state)
    HUD.visible = state and true or false
    HUD.Send('visible', { visible = HUD.visible and not HUD.paused })
end)

exports('IsVisible', function() return HUD.visible and not HUD.paused end)

exports('SetCinematic', function(state) setCinematic(state and true or false) end)
