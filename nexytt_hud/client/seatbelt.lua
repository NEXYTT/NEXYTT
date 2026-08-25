--=====================================================================
--  CINTURON DE SEGURIDAD
--=====================================================================

Seatbelt = { on = false, inVehicle = false }

local lastSpeed   = 0.0
local lastReminder = 0

local function ignoredVehicle(veh)
    return HUD.TableContains(Config.Seatbelt.ignoredClasses, HUD.VehicleClass(veh))
end

local function setBelt(state)
    if Seatbelt.on == state then return end
    Seatbelt.on = state

    local ped = PlayerPedId()
    -- Flag 32 = PED_FLAG_CAN_FLY_THRU_WINDSCREEN
    SetPedConfigFlag(ped, 32, not state)
    SetFlyThroughWindscreenParams(state and 100.0 or 17.0, state and 100.0 or 10.0, 0.0, 0.0)

    HUD.Send('seatbelt', { on = state })

    if state then
        PlaySoundFrontend(-1, 'Faster_Click', 'RESPAWN_ONLINE_SOUNDSET', true)
        HUD.Notify(L('belt_on'), 'success', 2000)
    else
        PlaySoundFrontend(-1, 'Menu_Back', 'Phone_SoundSet_Default', true)
        HUD.Notify(L('belt_off'), 'warning', 2000)
    end
end

function Seatbelt.Toggle()
    if not Config.Seatbelt.enabled then return end
    local ped = PlayerPedId()
    if not IsPedInAnyVehicle(ped, false) then return end

    local veh = GetVehiclePedIsIn(ped, false)
    if ignoredVehicle(veh) then return end

    setBelt(not Seatbelt.on)
end

--=====================================================================
--  EYECCION POR CHOQUE
--=====================================================================

local function eject(veh)
    local ped   = PlayerPedId()
    local coords = GetEntityCoords(ped)
    local vel    = GetEntityVelocity(veh)

    SetEntityCoords(ped, coords.x, coords.y, coords.z - 0.47, true, true, true, false)
    SetEntityVelocity(ped, vel.x * 1.35, vel.y * 1.35, vel.z * 1.35)
    Wait(1)
    SetPedToRagdoll(ped, 2500, 2500, 0, false, false, false)
    ApplyDamageToPed(ped, math.random(12, 28), false)
    PlaySoundFrontend(-1, 'Explosion_Txt', 'GTAO_Exploding_Vehicles_Soundset', true)
end

--=====================================================================
--  LOOP
--=====================================================================

CreateThread(function()
    if not Config.Seatbelt.enabled then return end

    while true do
        local wait = 350
        local ped  = PlayerPedId()

        if IsPedInAnyVehicle(ped, false) then
            local veh = GetVehiclePedIsIn(ped, false)

            if ignoredVehicle(veh) then
                if Seatbelt.on then setBelt(false) end
                Seatbelt.inVehicle = false
            else
                Seatbelt.inVehicle = true
                wait = 0

                local speedKmh = GetEntitySpeed(veh) * 3.6

                if Seatbelt.on then
                    -- No te podes bajar en marcha con el cinturon puesto
                    if Config.Seatbelt.blockExit then
                        DisableControlAction(0, 75, true)   -- INPUT_VEH_EXIT
                        DisableControlAction(27, 75, true)
                    end
                else
                    -- Choque: caida brusca de velocidad
                    if Config.Seatbelt.ejection
                       and lastSpeed >= Config.Seatbelt.ejectMinSpeed
                       and (lastSpeed - speedKmh) >= Config.Seatbelt.ejectDeltaSpeed
                       and GetPedInVehicleSeat(veh, -1) == ped then
                        eject(veh)
                    end

                    -- Recordatorio de cinturon
                    if Config.Seatbelt.reminder and speedKmh > Config.Seatbelt.reminderSpeed then
                        local now = GetGameTimer()
                        if now - lastReminder > 8000 then
                            lastReminder = now
                            PlaySoundFrontend(-1, 'CHECKPOINT_MISSED', 'HUD_MINI_GAME_SOUNDSET', true)
                            HUD.Notify(L('belt_warning'), 'warning', 2500)
                        end
                    end
                end

                lastSpeed = speedKmh
            end
        else
            if Seatbelt.on then setBelt(false) end
            Seatbelt.inVehicle = false
            lastSpeed = 0.0
        end

        Wait(wait)
    end
end)

CreateThread(function()
    HUD.BindKey('nexytt_seatbelt', L('seatbelt'), Config.Keys.seatbelt, function()
        Seatbelt.Toggle()
    end)
end)

exports('IsSeatbeltOn', function() return Seatbelt.on end)
exports('SetSeatbelt', function(state) setBelt(state and true or false) end)
