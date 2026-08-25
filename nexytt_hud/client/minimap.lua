--=====================================================================
--  MINIMAPA + BRUJULA
--=====================================================================

local compass = {
    heading  = 0.0,
    street   = '',
    crossing = '',
    zone     = '',
}

--=====================================================================
--  FORMA DEL MINIMAPA
--  'square' y 'circle' necesitan que dejes en la carpeta stream/ la
--  .ytd correspondiente (mirá stream/README.md). Si no está, el juego
--  simplemente mantiene la forma por defecto: no rompe nada.
--=====================================================================

local function applyShape()
    local shape = Config.Minimap.shape
    if shape ~= 'square' and shape ~= 'circle' then return end

    local dict = (shape == 'square') and 'squaremap' or 'circlemap'

    RequestStreamedTextureDict(dict, false)
    local timeout = GetGameTimer() + 5000
    while not HasStreamedTextureDictLoaded(dict) and GetGameTimer() < timeout do
        Wait(50)
    end

    if not HasStreamedTextureDictLoaded(dict) then
        if Config.Debug then
            print(('[nexytt_hud] no se encontró la textura "%s"; dejo el minimapa por defecto.'):format(dict))
        end
        return
    end

    AddReplaceTexture('platform:/textures/graphics', 'radarmasksm', dict, 'radarmasksm')
    AddReplaceTexture('platform:/textures/graphics', 'radarmask1g', dict, 'radarmasksm')

    -- Native opcional: no existe en todas las builds, por eso el guard.
    if SetMinimapClipType then pcall(SetMinimapClipType, shape == 'circle' and 1 or 0) end

    if Config.Debug then print(('[nexytt_hud] minimapa: %s'):format(shape)) end
end

local function applyPosition()
    if not Config.Minimap.reposition then return end
    local m = Config.Minimap
    SetMinimapComponentPosition('minimap',      'L', 'B', m.x, m.y, m.width, m.height)
    SetMinimapComponentPosition('minimap_mask', 'L', 'B', m.x, m.y, m.width, m.height)
    SetMinimapComponentPosition('minimap_blur', 'L', 'B', m.x - 0.01, m.y - 0.015, m.width + 0.02, m.height + 0.03)
end

--=====================================================================
--  BRÚJULA
--=====================================================================

local function cardinal(heading)
    -- 0 = Norte, aumentando en sentido antihorario en GTA
    if heading >= 337.5 or heading < 22.5  then return 'N'  end
    if heading < 67.5  then return 'NW' end
    if heading < 112.5 then return 'W'  end
    if heading < 157.5 then return 'SW' end
    if heading < 202.5 then return 'S'  end
    if heading < 247.5 then return 'SE' end
    if heading < 292.5 then return 'E'  end
    return 'NE'
end

local function readCompass()
    local ped    = PlayerPedId()
    local coords = GetEntityCoords(ped)

    -- Con la cámara, no con el ped: es lo que espera el jugador al mirar alrededor.
    local camRot  = GetGameplayCamRot(2)
    local heading = (camRot.z + 360.0) % 360.0

    compass.heading = heading

    if Config.Compass.showStreet then
        local streetHash, crossingHash = GetStreetNameAtCoord(coords.x, coords.y, coords.z)
        compass.street = streetHash ~= 0 and GetStreetNameFromHashKey(streetHash) or ''
        if Config.Compass.showCrossing and crossingHash ~= 0 then
            compass.crossing = GetStreetNameFromHashKey(crossingHash)
        else
            compass.crossing = ''
        end
    end

    if Config.Compass.showZone then
        compass.zone = GetLabelText(GetNameOfZone(coords.x, coords.y, coords.z)) or ''
    end
end

--=====================================================================
--  LOOPS
--=====================================================================

-- Oculta los componentes nativos que reemplazamos por el HUD propio.
CreateThread(function()
    while true do
        if HUD.visible and not HUD.paused then
            for _, component in ipairs(Config.HideHudComponents) do
                HideHudComponentThisFrame(component)
            end
        end
        Wait(0)
    end
end)

--=====================================================================
--  BARRAS NATIVAS DE VIDA Y CHALECO
--  No son un HudComponent: las dibuja el scaleform del minimapa, asi
--  que hay que apagarlas con SETUP_HEALTH_ARMOUR. El scaleform se
--  reinicia al reaparecer, por eso lo reaplicamos.
--=====================================================================

local function hideNativeHealthArmour()
    if not Config.HideNativeHealth then return end

    local scaleform = RequestScaleformMovie('minimap')
    local timeout = GetGameTimer() + 5000
    while not HasScaleformMovieLoaded(scaleform) and GetGameTimer() < timeout do
        Wait(0)
    end
    if not HasScaleformMovieLoaded(scaleform) then return end

    BeginScaleformMovieMethod(scaleform, 'SETUP_HEALTH_ARMOUR')
    ScaleformMovieMethodAddParamInt(3)   -- 3 = ocultar vida y chaleco
    EndScaleformMovieMethod()
end

CreateThread(function()
    if not Config.HideNativeHealth then return end

    Wait(1500)
    hideNativeHealthArmour()

    local wasDead = false
    while true do
        local dead = IsEntityDead(PlayerPedId())
        -- Al reaparecer el scaleform vuelve a dibujar las barras
        if wasDead and not dead then
            Wait(2500)
            hideNativeHealthArmour()
        end
        wasDead = dead
        Wait(1000)
    end
end)

-- Datos de la brújula hacia la NUI
CreateThread(function()
    while true do
        local wait = Config.Tick.normal

        if HUD.visible and not HUD.paused and Config.Compass.enabled and HUD.settings.showCompass then
            local inVehicle = IsPedInAnyVehicle(PlayerPedId(), false)
            if Config.Compass.vehicleOnly and not inVehicle then
                HUD.Send('compass', { visible = false })
            else
                readCompass()
                HUD.Send('compass', {
                    visible  = true,
                    heading  = HUD.Round(compass.heading, 1),
                    cardinal = cardinal(compass.heading),
                    street   = HUD.settings.showStreet and compass.street or '',
                    crossing = HUD.settings.showStreet and compass.crossing or '',
                    zone     = compass.zone,
                })
            end
        else
            HUD.Send('compass', { visible = false })
            wait = 500
        end

        Wait(wait)
    end
end)

-- Minimapa: visibilidad a pie
CreateThread(function()
    if not Config.Minimap.hideOnFoot then return end
    while true do
        local inVehicle = IsPedInAnyVehicle(PlayerPedId(), false)
        DisplayRadar(inVehicle and HUD.visible)
        Wait(400)
    end
end)

CreateThread(function()
    Wait(1000)
    applyShape()
    applyPosition()
    if Config.Minimap.zoom then SetRadarZoom(Config.Minimap.zoom) end
    SetBigmapActive(false, false)
end)

--- Exporta la lectura actual por si otro resource la quiere reutilizar.
exports('GetCompass', function()
    return {
        heading  = compass.heading,
        cardinal = cardinal(compass.heading),
        street   = compass.street,
        crossing = compass.crossing,
        zone     = compass.zone,
    }
end)
