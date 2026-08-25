--=====================================================================
--  BRIDGE DE FRAMEWORK (cliente)
--  Detecta ESX Legacy / QBCore / QBox y expone una API unica al HUD.
--  Si no hay ninguno, cae en modo standalone con necesidades simuladas.
--=====================================================================

Bridge = {
    name   = 'standalone',   -- esx | qb | qbx | standalone
    core   = nil,            -- objeto del framework
    loaded = false,          -- el jugador ya termino de spawnear
    data   = {
        cash   = 0,
        bank   = 0,
        black  = 0,
        job    = nil,
        hunger = 100.0,
        thirst = 100.0,
        stress = 0.0,
    },
}

local listeners = { loaded = {}, unloaded = {}, money = {}, job = {} }

local function emit(event, ...)
    for _, cb in ipairs(listeners[event] or {}) do
        local ok, err = pcall(cb, ...)
        if not ok then print(('[nexytt_hud] error en listener %s: %s'):format(event, err)) end
    end
end

function Bridge.On(event, cb)
    listeners[event] = listeners[event] or {}
    listeners[event][#listeners[event] + 1] = cb
end

local function dbg(msg)
    if Config.Debug then print(('[nexytt_hud] %s'):format(msg)) end
end

--=====================================================================
--  DETECCION
--=====================================================================

local function started(res)
    return res and res ~= '' and GetResourceState(res) == 'started'
end

local function detect()
    if Config.Framework ~= 'auto' then return Config.Framework end
    if started(Config.Resources.esx) then return 'esx' end
    if started(Config.Resources.qbx) then return 'qbx' end
    if started(Config.Resources.qb)  then return 'qb'  end
    return 'standalone'
end

--=====================================================================
--  ADAPTADORES
--=====================================================================

local adapters = {}

---------------------------------------------------------------- ESX --
adapters.esx = function()
    local res = Config.Resources.esx
    local ESX

    -- ESX Legacy 1.9+ expone getSharedObject como export
    local ok, obj = pcall(function() return exports[res]:getSharedObject() end)
    if ok and obj then
        ESX = obj
    else
        -- Fallback para builds antiguas
        local timeout = GetGameTimer() + 10000
        TriggerEvent('esx:getSharedObject', function(o) ESX = o end)
        while not ESX and GetGameTimer() < timeout do Wait(50) end
    end

    if not ESX then
        print('[nexytt_hud] ESX detectado pero no se pudo obtener el objeto compartido. Paso a standalone.')
        return false
    end

    Bridge.core = ESX

    local function pull(playerData)
        playerData = playerData or ESX.GetPlayerData() or {}
        Bridge.data.cash = playerData.money or 0
        Bridge.data.job  = playerData.job
        for _, acc in ipairs(playerData.accounts or {}) do
            if acc.name == 'bank'        then Bridge.data.bank  = acc.money or 0 end
            if acc.name == 'black_money' then Bridge.data.black = acc.money or 0 end
        end
    end

    if ESX.IsPlayerLoaded and ESX.IsPlayerLoaded() then
        Bridge.loaded = true
        pull()
    end

    RegisterNetEvent('esx:playerLoaded', function(xPlayer)
        Bridge.loaded = true
        pull(xPlayer)
        emit('loaded')
        emit('money')
        emit('job', Bridge.data.job)
    end)

    RegisterNetEvent('esx:onPlayerLogout', function()
        Bridge.loaded = false
        emit('unloaded')
    end)

    RegisterNetEvent('esx:setAccountMoney', function(account)
        if not account or not account.name then return end
        if account.name == 'bank'        then Bridge.data.bank  = account.money or 0 end
        if account.name == 'black_money' then Bridge.data.black = account.money or 0 end
        emit('money')
    end)

    RegisterNetEvent('esx:setJob', function(job)
        Bridge.data.job = job
        emit('job', job)
    end)

    -- ESX no dispara evento por el cash: lo refrescamos en el loop lento
    Bridge.RefreshMoney = function() pull() end

    -- esx_status -> hambre / sed (valores 0..1000000)
    if started('esx_status') then
        AddEventHandler('esx_status:onTick', function(data)
            for _, st in pairs(data) do
                local pct = (st.percent ~= nil) and st.percent or ((st.val or 0) / 10000)
                if st.name == 'hunger' then Bridge.data.hunger = pct + 0.0 end
                if st.name == 'thirst' then Bridge.data.thirst = pct + 0.0 end
                if st.name == 'stress' then Bridge.data.stress = pct + 0.0 end
            end
        end)
        Bridge.hasNeeds = true
    end

    dbg('framework = ESX Legacy')
    return true
end

------------------------------------------------------------- QBCORE --
local function bindQB(QB, resName)
    Bridge.core = QB

    local function pull(pd)
        pd = pd or (QB.Functions and QB.Functions.GetPlayerData and QB.Functions.GetPlayerData()) or {}
        local money = pd.money or {}
        Bridge.data.cash  = money.cash   or money['cash']   or 0
        Bridge.data.bank  = money.bank   or money['bank']   or 0
        Bridge.data.black = money.crypto or money['crypto'] or 0
        Bridge.data.job   = pd.job
        local meta = pd.metadata or {}
        if meta.hunger then Bridge.data.hunger = meta.hunger + 0.0 end
        if meta.thirst then Bridge.data.thirst = meta.thirst + 0.0 end
        if meta.stress then Bridge.data.stress = meta.stress + 0.0 end
    end

    local pd = QB.Functions and QB.Functions.GetPlayerData and QB.Functions.GetPlayerData()
    if pd and pd.citizenid then
        Bridge.loaded = true
        pull(pd)
    end

    RegisterNetEvent('QBCore:Client:OnPlayerLoaded', function()
        Bridge.loaded = true
        pull()
        emit('loaded'); emit('money'); emit('job', Bridge.data.job)
    end)

    RegisterNetEvent('QBCore:Client:OnPlayerUnload', function()
        Bridge.loaded = false
        emit('unloaded')
    end)

    RegisterNetEvent('QBCore:Player:SetPlayerData', function(data)
        pull(data)
        emit('money'); emit('job', Bridge.data.job)
    end)

    RegisterNetEvent('QBCore:Client:OnJobUpdate', function(job)
        Bridge.data.job = job
        emit('job', job)
    end)

    -- Eventos estandar del qb-hud original: dejamos que otros scripts nos alimenten
    RegisterNetEvent('hud:client:UpdateNeeds', function(hunger, thirst)
        if hunger then Bridge.data.hunger = hunger + 0.0 end
        if thirst then Bridge.data.thirst = thirst + 0.0 end
    end)

    RegisterNetEvent('hud:client:UpdateStress', function(stress)
        if stress then Bridge.data.stress = stress + 0.0 end
    end)

    Bridge.RefreshMoney = function() pull() end
    Bridge.hasNeeds = true

    dbg(('framework = %s'):format(resName))
    return true
end

adapters.qb = function()
    local res = Config.Resources.qb
    local ok, QB = pcall(function() return exports[res]:GetCoreObject() end)
    if not ok or not QB then
        print('[nexytt_hud] qb-core detectado pero GetCoreObject fallo. Paso a standalone.')
        return false
    end
    return bindQB(QB, 'QBCore')
end

adapters.qbx = function()
    -- QBox mantiene compatibilidad con qb-core; si existe usamos ese objeto,
    -- si no leemos qbx_core directamente.
    if started(Config.Resources.qb) then
        local ok, QB = pcall(function() return exports[Config.Resources.qb]:GetCoreObject() end)
        if ok and QB then return bindQB(QB, 'QBox (via qb-core)') end
    end

    local res = Config.Resources.qbx

    local function pull()
        local ok, pd = pcall(function() return exports[res]:GetPlayerData() end)
        if not ok or not pd then return end
        local money = pd.money or {}
        Bridge.data.cash  = money.cash   or 0
        Bridge.data.bank  = money.bank   or 0
        Bridge.data.black = money.crypto or 0
        Bridge.data.job   = pd.job
        local meta = pd.metadata or {}
        if meta.hunger then Bridge.data.hunger = meta.hunger + 0.0 end
        if meta.thirst then Bridge.data.thirst = meta.thirst + 0.0 end
        if meta.stress then Bridge.data.stress = meta.stress + 0.0 end
    end

    pull()
    if Bridge.data.job then Bridge.loaded = true end

    RegisterNetEvent('QBCore:Client:OnPlayerLoaded', function()
        Bridge.loaded = true; pull(); emit('loaded'); emit('money')
    end)
    RegisterNetEvent('qbx_core:client:playerLoaded', function()
        Bridge.loaded = true; pull(); emit('loaded'); emit('money')
    end)
    RegisterNetEvent('QBCore:Player:SetPlayerData', function() pull(); emit('money') end)
    RegisterNetEvent('hud:client:UpdateNeeds', function(h, t)
        if h then Bridge.data.hunger = h + 0.0 end
        if t then Bridge.data.thirst = t + 0.0 end
    end)
    RegisterNetEvent('hud:client:UpdateStress', function(s)
        if s then Bridge.data.stress = s + 0.0 end
    end)

    Bridge.RefreshMoney = pull
    Bridge.hasNeeds = true
    dbg('framework = QBox (qbx_core)')
    return true
end

--------------------------------------------------------- STANDALONE --

--- Decaimiento simulado de hambre/sed y recuperacion de estres.
--- Se usa en standalone y como red de seguridad si el framework no
--- expone necesidades (por ejemplo ESX sin esx_status).
local decayRunning = false
local function startFallbackDecay()
    if decayRunning or not Config.Status.fallbackDecay then return end
    decayRunning = true

    CreateThread(function()
        while true do
            Wait(60000)
            local d = Bridge.data
            d.hunger = math.max(0.0, d.hunger - Config.Status.hungerPerMinute)
            d.thirst = math.max(0.0, d.thirst - Config.Status.thirstPerMinute)
            d.stress = math.max(0.0, d.stress - Config.Status.stressDecay)

            -- Con hambre o sed a cero empezas a perder vida
            if d.hunger <= 0 or d.thirst <= 0 then
                local ped = PlayerPedId()
                if not IsEntityDead(ped) then
                    SetEntityHealth(ped, math.max(101, GetEntityHealth(ped) - 5))
                end
            end
        end
    end)
end

adapters.standalone = function()
    Bridge.loaded   = true
    Bridge.hasNeeds = false
    startFallbackDecay()

    Bridge.RefreshMoney = function() end
    dbg('framework = standalone')
    return true
end

--=====================================================================
--  API PUBLICA
--=====================================================================

function Bridge.IsLoaded()  return Bridge.loaded end
function Bridge.GetCash()   return Bridge.data.cash   or 0 end
function Bridge.GetBank()   return Bridge.data.bank   or 0 end
function Bridge.GetBlack()  return Bridge.data.black  or 0 end
function Bridge.GetHunger() return Bridge.data.hunger or 100.0 end
function Bridge.GetThirst() return Bridge.data.thirst or 100.0 end
function Bridge.GetStress() return Bridge.data.stress or 0.0 end

function Bridge.GetJobLabel()
    local job = Bridge.data.job
    if not job then return L('unemployed') end
    local label = job.label or job.name or L('unemployed')
    local grade = job.grade_label or (job.grade and job.grade.name)
    if grade and grade ~= '' then return ('%s · %s'):format(label, grade) end
    return label
end

--- Permite que otros resources escriban las necesidades (util en standalone).
function Bridge.SetNeed(name, value)
    if Bridge.data[name] == nil then return end
    Bridge.data[name] = math.max(0.0, math.min(100.0, value + 0.0))
end

exports('SetNeed', Bridge.SetNeed)
exports('GetFramework', function() return Bridge.name end)

--=====================================================================
--  ARRANQUE
--=====================================================================

CreateThread(function()
    -- Damos margen a que el framework termine de iniciar
    Wait(500)

    Bridge.name = detect()
    local adapter = adapters[Bridge.name] or adapters.standalone

    if not adapter() then
        Bridge.name = 'standalone'
        adapters.standalone()
    end

    -- Si el framework no expone necesidades, las simulamos nosotros
    -- (sin tocar Bridge.loaded, que lo maneja el adaptador real).
    if not Bridge.hasNeeds then startFallbackDecay() end

    if Bridge.loaded then emit('loaded') end
end)
