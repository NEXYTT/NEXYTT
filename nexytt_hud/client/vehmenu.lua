--=====================================================================
--  MENU CENITAL DEL VEHICULO
--  Vista de pajaro con puertas, ventanillas, ruedas, motor y seguro.
--  Se puede accionar cada puerta y ventanilla desde el propio dibujo.
--=====================================================================

VehMenu = { open = false, vehicle = 0 }

-- 0 delantera izq · 1 delantera der · 2 trasera izq · 3 trasera der · 4 capo · 5 maletero
local DOORS   = { 0, 1, 2, 3, 4, 5 }
local WINDOWS = { 0, 1, 2, 3 }
-- Indices de rueda en GTA: 0 y 1 delante, 4 y 5 detras
local WHEELS  = { 0, 1, 4, 5 }

-- Las ventanillas bajadas no se distinguen de las rotas con los natives,
-- asi que recordamos nosotros cual bajamos.
local rolledDown = {}

local function controlledVehicle()
    local ped = PlayerPedId()
    if not IsPedInAnyVehicle(ped, false) then return 0 end

    local veh = GetVehiclePedIsIn(ped, false)
    if veh == 0 or not DoesEntityExist(veh) then return 0 end

    if Config.VehicleMenu.driverOnly and GetPedInVehicleSeat(veh, -1) ~= ped then
        return 0, true   -- hay vehiculo pero no vas de conductor
    end

    return veh
end

--=====================================================================
--  LECTURA
--=====================================================================

local function read(veh)
    local doors = {}
    for _, index in ipairs(DOORS) do
        local exists = GetVehicleDoorAngleRatio(veh, index) ~= nil
        doors[#doors + 1] = {
            index  = index,
            open   = GetVehicleDoorAngleRatio(veh, index) > 0.05,
            broken = IsVehicleDoorDamaged(veh, index),
            exists = exists,
        }
    end

    local windows = {}
    for _, index in ipairs(WINDOWS) do
        windows[#windows + 1] = {
            index  = index,
            broken = not IsVehicleWindowIntact(veh, index) and not rolledDown[index],
            down   = rolledDown[index] == true,
        }
    end

    local tyres = {}
    local wheelCount = GetVehicleNumberOfWheels(veh)
    for slot, index in ipairs(WHEELS) do
        -- En vehiculos de dos ruedas solo existen las posiciones 0 y 4
        local present = wheelCount >= 4 or index == 0 or index == 4
        tyres[slot] = {
            index   = index,
            present = present,
            burst   = present and GetVehicleTyreBurst(veh, index, false) or false,
            gone    = present and GetVehicleTyreBurst(veh, index, true) or false,
        }
    end

    local fuel = HUD.GetFuel and HUD.GetFuel(veh) or GetVehicleFuelLevel(veh)

    return {
        visible = true,
        name    = GetLabelText(GetDisplayNameFromVehicleModel(GetEntityModel(veh))),
        plate   = (GetVehicleNumberPlateText(veh) or ''):gsub('%s+$', ''),
        engine  = HUD.Clamp(GetVehicleEngineHealth(veh) / 10.0, 0.0, 100.0),
        body    = HUD.Clamp(GetVehicleBodyHealth(veh) / 10.0, 0.0, 100.0),
        fuel    = HUD.Clamp(fuel or 0.0, 0.0, 100.0),
        locked  = GetVehicleDoorLockStatus(veh) >= 2,
        running = GetIsVehicleEngineRunning(veh),
        doors   = doors,
        windows = windows,
        tyres   = tyres,
        config  = {
            doors   = Config.VehicleMenu.showDoors,
            windows = Config.VehicleMenu.showWindows,
            tyres   = Config.VehicleMenu.showTyres,
            lock    = Config.VehicleMenu.showLock,
            engine  = Config.VehicleMenu.showEngine,
            allowEngine = Config.VehicleMenu.allowEngine,
        },
    }
end

local function refresh()
    if not VehMenu.open then return end

    local veh = VehMenu.vehicle
    if veh == 0 or not DoesEntityExist(veh) then
        VehMenu.Close()
        return
    end

    HUD.Send('vehmenu', read(veh))
end

--=====================================================================
--  APERTURA / CIERRE
--=====================================================================

function VehMenu.Open()
    if not Config.VehicleMenu.enabled or VehMenu.open then return end

    local veh, wrongSeat = controlledVehicle()
    if veh == 0 then
        if wrongSeat then HUD.Notify(L('veh_no_keys'), 'error', 3000) end
        return
    end

    VehMenu.open = true
    VehMenu.vehicle = veh
    SetNuiFocus(true, true)
    HUD.Send('vehmenu', read(veh))
    HUD.Send('vehmenuOpen', { open = true })
end

function VehMenu.Close()
    if not VehMenu.open then return end
    VehMenu.open = false
    VehMenu.vehicle = 0
    SetNuiFocus(false, false)
    HUD.Send('vehmenuOpen', { open = false })
end

function VehMenu.Toggle()
    if VehMenu.open then VehMenu.Close() else VehMenu.Open() end
end

-- Refresco mientras esta abierto, y cierre si te bajas del coche
CreateThread(function()
    while true do
        if VehMenu.open then
            local ped = PlayerPedId()
            if not IsPedInAnyVehicle(ped, false) or GetVehiclePedIsIn(ped, false) ~= VehMenu.vehicle then
                VehMenu.Close()
            else
                refresh()
            end
            Wait(400)
        else
            Wait(600)
        end
    end
end)

--=====================================================================
--  ACCIONES
--=====================================================================

RegisterNUICallback('vehDoor', function(data, cb)
    local veh = VehMenu.vehicle
    if veh ~= 0 and DoesEntityExist(veh) and Config.VehicleMenu.showDoors then
        local index = tonumber(data and data.index)
        if index then
            if GetVehicleDoorAngleRatio(veh, index) > 0.05 then
                SetVehicleDoorShut(veh, index, false)
            else
                SetVehicleDoorOpen(veh, index, false, false)
            end
        end
    end
    refresh()
    cb({ ok = true })
end)

RegisterNUICallback('vehWindow', function(data, cb)
    local veh = VehMenu.vehicle
    if veh ~= 0 and DoesEntityExist(veh) and Config.VehicleMenu.showWindows then
        local index = tonumber(data and data.index)
        if index then
            if rolledDown[index] then
                RollUpWindow(veh, index)
                rolledDown[index] = nil
            else
                RollDownWindow(veh, index)
                rolledDown[index] = true
            end
        end
    end
    refresh()
    cb({ ok = true })
end)

RegisterNUICallback('vehLock', function(_, cb)
    local veh = VehMenu.vehicle
    if veh ~= 0 and DoesEntityExist(veh) and Config.VehicleMenu.showLock then
        local locked = GetVehicleDoorLockStatus(veh) >= 2
        SetVehicleDoorsLocked(veh, locked and 1 or 2)
        PlaySoundFrontend(-1, locked and 'Menu_Accept' or 'Menu_Back', 'Phone_SoundSet_Default', true)
    end
    refresh()
    cb({ ok = true })
end)

RegisterNUICallback('vehEngine', function(_, cb)
    local veh = VehMenu.vehicle
    if veh ~= 0 and DoesEntityExist(veh) and Config.VehicleMenu.allowEngine then
        local running = GetIsVehicleEngineRunning(veh)
        SetVehicleEngineOn(veh, not running, false, true)
        HUD.Notify(running and L('veh_engine_off') or L('veh_engine_on'), 'info', 2000)
    end
    refresh()
    cb({ ok = true })
end)

RegisterNUICallback('vehmenuClose', function(_, cb)
    VehMenu.Close()
    cb({ ok = true })
end)

--=====================================================================
--  ENTRADA
--=====================================================================

CreateThread(function()
    if not Config.VehicleMenu.enabled then return end

    HUD.BindKey(Config.Commands.vehicleMenu, L('veh_menu'), Config.Keys.vehicleMenu, function()
        VehMenu.Toggle()
    end)
end)

-- Al cambiar de vehiculo olvidamos que ventanillas habiamos bajado
AddEventHandler('gameEventTriggered', function(event, args)
    if event == 'CEventNetworkPlayerEnteredVehicle' then
        rolledDown = {}
    end
end)

exports('OpenVehicleMenu', VehMenu.Open)
exports('IsVehicleMenuOpen', function() return VehMenu.open end)
