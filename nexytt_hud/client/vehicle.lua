--=====================================================================
--  HUD DE VEHICULO
--  velocimetro · rpm · marcha · gasolina · motor · luces · intermitentes
--  · cinturon · control de crucero
--=====================================================================

local Vehicle = { current = 0, visible = false }

local cruise = { active = false, speed = 0.0 }
local lowFuelWarned = false

--=====================================================================
--  COMBUSTIBLE
--=====================================================================

local fuelGetter

local function buildFuelGetter()
    local function nativeFuel(veh) return GetVehicleFuelLevel(veh) end

    local function fromResource(entry)
        if GetResourceState(entry.name) ~= 'started' then return nil end

        -- ox_fuel guarda el nivel en el statebag de la entidad
        if entry.name == 'ox_fuel' then
            return function(veh)
                local st = Entity(veh).state
                return (st and st.fuel) or nativeFuel(veh)
            end
        end

        if not entry.export then return nil end

        local res = exports[entry.name]
        if not res or type(res[entry.export]) ~= 'function' then return nil end

        return function(veh)
            local ok, value = pcall(res[entry.export], res, veh)
            if ok and type(value) == 'number' then return value end
            return nativeFuel(veh)
        end
    end

    if Config.Fuel.resource ~= 'auto' then
        for _, entry in ipairs(Config.Fuel.known) do
            if entry.name == Config.Fuel.resource then
                local getter = fromResource(entry)
                if getter then
                    if Config.Debug then print(('[nexytt_hud] fuel = %s'):format(entry.name)) end
                    return getter
                end
            end
        end
        if Config.Debug then print('[nexytt_hud] fuel: resource configurado no disponible, uso el nativo') end
        return nativeFuel
    end

    for _, entry in ipairs(Config.Fuel.known) do
        local getter = fromResource(entry)
        if getter then
            if Config.Debug then print(('[nexytt_hud] fuel = %s'):format(entry.name)) end
            return getter
        end
    end

    if Config.Debug then print('[nexytt_hud] fuel = nativo (GetVehicleFuelLevel)') end
    return nativeFuel
end

--=====================================================================
--  CONTROL DE CRUCERO
--=====================================================================

local function speedLabel(kmh)
    if HUD.settings.units == 'mph' then
        return ('%d mph'):format(math.floor(kmh / 1.609344))
    end
    return ('%d km/h'):format(math.floor(kmh))
end

local function setCruise(state, veh)
    if not Config.Vehicle.cruiseControl then return end

    if state and veh and veh ~= 0 then
        local speed = GetEntitySpeed(veh)
        if speed * 3.6 < 20.0 then return end   -- demasiado lento para fijar crucero
        cruise.active = true
        cruise.speed  = speed
        HUD.Notify(L('cruise_on', speedLabel(speed * 3.6)), 'info', 2500)
    else
        if not cruise.active then return end
        cruise.active = false
        cruise.speed  = 0.0
        HUD.Notify(L('cruise_off'), 'info', 2000)
    end

    HUD.Send('cruise', { active = cruise.active })
end

--=====================================================================
--  LECTURA DEL VEHICULO
--=====================================================================

local function readVehicle(veh)
    local speedMs = GetEntitySpeed(veh)
    local kmh     = speedMs * 3.6
    local useMph  = HUD.settings.units == 'mph'

    local speed    = useMph and (kmh / 1.609344) or kmh
    local maxSpeed = useMph and Config.Vehicle.maxSpeedMph or Config.Vehicle.maxSpeedKmh

    local rpm = GetVehicleCurrentRpm(veh)

    -- Marcha: 0 es marcha atras en GTA
    local gearNum = GetVehicleCurrentGear(veh)
    local gear
    if IsVehicleStopped(veh) and kmh < 1.0 then
        gear = 'N'
    elseif gearNum == 0 then
        gear = 'R'
    else
        gear = tostring(gearNum)
    end

    local fuel = HUD.Clamp(fuelGetter(veh) or 0.0, 0.0, 100.0)

    local engine = HUD.Clamp(GetVehicleEngineHealth(veh) / 10.0, 0.0, 100.0)

    local _, lightsOn, highBeams = GetVehicleLightsState(veh)

    local indicators = 0
    if GetVehicleIndicatorLights then
        local ok, value = pcall(GetVehicleIndicatorLights, veh)
        if ok and type(value) == 'number' then indicators = value end
    end

    -- Aviso de reserva
    if fuel <= 15.0 and not lowFuelWarned then
        lowFuelWarned = true
        HUD.Notify(L('no_fuel'), 'warning', 4000)
    elseif fuel > 25.0 then
        lowFuelWarned = false
    end

    return {
        visible    = true,
        speed      = math.floor(speed + 0.5),
        speedPct   = HUD.Clamp(speed / maxSpeed * 100.0, 0.0, 100.0),
        maxSpeed   = maxSpeed,
        units      = useMph and 'mph' or 'km/h',
        rpm        = HUD.Round(HUD.Clamp(rpm, 0.0, 1.0) * 100.0, 1),
        gear       = gear,
        fuel       = HUD.Round(fuel, 1),
        engine     = HUD.Round(engine, 1),
        lights     = lightsOn == 1 or lightsOn == true,
        highBeams  = highBeams == 1 or highBeams == true,
        indicators = indicators,
        seatbelt   = Seatbelt.on,
        cruise     = cruise.active,
        driver     = GetPedInVehicleSeat(veh, -1) == PlayerPedId(),
    }
end

--=====================================================================
--  LOOP PRINCIPAL DEL VEHICULO
--=====================================================================

CreateThread(function()
    Wait(1200)
    fuelGetter = buildFuelGetter()

    while true do
        local wait = 400
        local ped  = PlayerPedId()

        local shouldShow = HUD.visible and not HUD.paused
                           and HUD.settings.showVehicleHud
                           and IsPedInAnyVehicle(ped, false)

        if shouldShow then
            local veh = GetVehiclePedIsIn(ped, false)
            local isDriver = GetPedInVehicleSeat(veh, -1) == ped

            if Config.Vehicle.driverOnly and not isDriver then
                if Vehicle.visible then
                    Vehicle.visible = false
                    HUD.Send('vehicle', { visible = false })
                end
                wait = 400
            else
                Vehicle.current = veh
                Vehicle.visible = true
                wait = Config.Tick.fast

                local data = readVehicle(veh)
                data.showRpm    = HUD.settings.showRpm
                data.showFuel   = HUD.settings.showFuel
                data.showEngine = HUD.settings.showEngine
                data.showBelt   = HUD.settings.showBelt
                HUD.Send('vehicle', data)
            end
        else
            if Vehicle.visible then
                Vehicle.visible = false
                Vehicle.current = 0
                HUD.Send('vehicle', { visible = false })
                if cruise.active then setCruise(false) end
                lowFuelWarned = false
            end
        end

        Wait(wait)
    end
end)

--=====================================================================
--  MANTENIMIENTO DEL CRUCERO (cada frame, solo si esta activo)
--=====================================================================

CreateThread(function()
    while true do
        if cruise.active then
            local ped = PlayerPedId()

            if not IsPedInAnyVehicle(ped, false) then
                setCruise(false)
            else
                local veh = GetVehiclePedIsIn(ped, false)

                -- Frenar, poner el freno de mano o salirse cancela el crucero
                if IsControlPressed(0, 72) or IsControlPressed(0, 76) or GetPedInVehicleSeat(veh, -1) ~= ped then
                    setCruise(false)
                else
                    local speed = GetEntitySpeed(veh)
                    if speed < cruise.speed - 0.3 then
                        SetVehicleForwardSpeed(veh, math.min(cruise.speed, speed + 0.35))
                    end
                end
            end
            Wait(0)
        else
            Wait(300)
        end
    end
end)

CreateThread(function()
    if not Config.Vehicle.cruiseControl then return end

    HUD.BindKey('nexytt_cruise', L('cruise'), Config.Keys.cruise, function()
        local ped = PlayerPedId()
        if not IsPedInAnyVehicle(ped, false) then return end
        local veh = GetVehiclePedIsIn(ped, false)
        if GetPedInVehicleSeat(veh, -1) ~= ped then return end
        setCruise(not cruise.active, veh)
    end)
end)

exports('GetVehicleData', function()
    if Vehicle.current == 0 or not DoesEntityExist(Vehicle.current) then return nil end
    return readVehicle(Vehicle.current)
end)

exports('IsCruiseActive', function() return cruise.active end)
