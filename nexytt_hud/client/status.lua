--=====================================================================
--  ESTADO DEL JUGADOR
--  vida · chaleco · hambre · sed · estres · oxigeno · energia
--=====================================================================

local status = {
    health = 100.0, armor = 0.0, hunger = 100.0, thirst = 100.0,
    stress = 0.0,   oxygen = 100.0, stamina = 100.0,
}

-- Valores suavizados: la barra viaja hasta el valor real en vez de saltar.
local smooth = {}
for k, v in pairs(status) do smooth[k] = v end

local stressFx = { blur = false, lastShake = 0 }

--=====================================================================
--  LECTURA
--=====================================================================

local function readFast(ped, playerId)
    -- Vida: en GTA 100 es la muerte, no el cero.
    local maxHealth = GetEntityMaxHealth(ped)
    local health    = GetEntityHealth(ped)
    if maxHealth > 100 then
        status.health = HUD.Clamp((health - 100) / (maxHealth - 100) * 100.0, 0.0, 100.0)
    else
        status.health = HUD.Clamp(health / math.max(1, maxHealth) * 100.0, 0.0, 100.0)
    end
    if IsEntityDead(ped) then status.health = 0.0 end

    -- Chaleco
    local maxArmour = GetPlayerMaxArmour(playerId)
    if maxArmour <= 0 then maxArmour = 100 end
    status.armor = HUD.Clamp(GetPedArmour(ped) / maxArmour * 100.0, 0.0, 100.0)

    -- Energia: el native devuelve el aguante GASTADO, por eso lo invertimos.
    status.stamina = HUD.Clamp(100.0 - GetPlayerSprintStaminaRemaining(playerId), 0.0, 100.0)

    -- Oxigeno: solo tiene sentido bajo el agua
    if IsPedSwimmingUnderWater(ped) then
        status.oxygen = HUD.Clamp(GetPlayerUnderwaterTimeRemaining(playerId) * 10.0, 0.0, 100.0)
    else
        status.oxygen = 100.0
    end
end

local function readSlow()
    status.hunger = HUD.Clamp(Bridge.GetHunger(), 0.0, 100.0)
    status.thirst = HUD.Clamp(Bridge.GetThirst(), 0.0, 100.0)
    status.stress = HUD.Clamp(Bridge.GetStress(), 0.0, 100.0)
end

--=====================================================================
--  EFECTOS DE ESTRES
--=====================================================================

local function applyStressEffects()
    if not Config.Status.stressEffects or HUD.settings.stressEffects == false then
        if stressFx.blur then
            ClearTimecycleModifier()
            stressFx.blur = false
        end
        return
    end

    local s = status.stress

    if s >= Config.Status.stressBlurAt then
        if not stressFx.blur then
            SetTimecycleModifier('BarryFadeOut')
            stressFx.blur = true
        end
        SetTimecycleModifierStrength(HUD.Clamp((s - Config.Status.stressBlurAt) / 40.0, 0.1, 1.0))
    elseif stressFx.blur then
        ClearTimecycleModifier()
        stressFx.blur = false
    end

    if s >= Config.Status.stressShakeAt then
        local now = GetGameTimer()
        if now - stressFx.lastShake > 900 then
            stressFx.lastShake = now
            ShakeGameplayCam('SMALL_EXPLOSION_SHAKE', HUD.Clamp((s - Config.Status.stressShakeAt) / 100.0, 0.02, 0.14))
        end
    end
end

--=====================================================================
--  ENVIO A LA NUI
--=====================================================================

local function push()
    -- Suavizamos todo menos la vida y el chaleco, que deben responder al instante.
    for key, target in pairs(status) do
        if key == 'health' or key == 'armor' then
            smooth[key] = target
        else
            smooth[key] = HUD.Lerp(smooth[key] or target, target, 0.35)
            if math.abs(smooth[key] - target) < 0.15 then smooth[key] = target end
        end
    end

    HUD.Send('status', {
        health  = HUD.Round(smooth.health, 1),
        armor   = HUD.Round(smooth.armor, 1),
        hunger  = HUD.Round(smooth.hunger, 1),
        thirst  = HUD.Round(smooth.thirst, 1),
        stress  = HUD.Round(smooth.stress, 1),
        oxygen  = HUD.Round(smooth.oxygen, 1),
        stamina = HUD.Round(smooth.stamina, 1),
        underwater = IsPedSwimmingUnderWater(PlayerPedId()),
        talking    = HUD.talking or false,
        warnAt     = Config.Status.warnAt,
        dangerAt   = Config.Status.dangerAt,
    })
end

--=====================================================================
--  LOOPS
--=====================================================================

CreateThread(function()
    while true do
        if HUD.visible and not HUD.paused then
            local playerId = PlayerId()
            readFast(PlayerPedId(), playerId)
            push()
            Wait(Config.Tick.fast)
        else
            Wait(500)
        end
    end
end)

CreateThread(function()
    while true do
        if HUD.visible and not HUD.paused then
            readSlow()
            applyStressEffects()
        end
        Wait(Config.Tick.slow)
    end
end)

--- exports['nexytt_hud']:GetStatus()
exports('GetStatus', function()
    local copy = {}
    for k, v in pairs(status) do copy[k] = v end
    return copy
end)
