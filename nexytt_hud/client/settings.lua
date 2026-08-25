--=====================================================================
--  AJUSTES DEL JUGADOR
--  Se guardan localmente con KVP, asi que sobreviven a reinicios del
--  resource y del servidor sin necesitar base de datos.
--=====================================================================

local KVP_KEY = 'nexytt_hud:settings:v1'
local menuOpen = false

local function deepCopy(tbl)
    local out = {}
    for k, v in pairs(tbl) do
        out[k] = (type(v) == 'table') and deepCopy(v) or v
    end
    return out
end

--- Mezcla los valores guardados sobre los defaults, descartando claves
--- viejas que ya no existan en Config.Defaults.
local function merge(saved)
    local out = deepCopy(Config.Defaults)
    if type(saved) ~= 'table' then return out end
    for k, v in pairs(saved) do
        if out[k] ~= nil and type(out[k]) == type(v) then out[k] = v end
    end
    return out
end

function HUD.LoadSettings()
    local raw = GetResourceKvpString(KVP_KEY)
    local saved
    if raw and raw ~= '' then
        local ok, decoded = pcall(json.decode, raw)
        if ok then saved = decoded end
    end
    HUD.settings = merge(saved)
    HUD.visible  = HUD.settings.hudEnabled
    return HUD.settings
end

function HUD.SaveSettings()
    SetResourceKvp(KVP_KEY, json.encode(HUD.settings))
end

function HUD.ResetSettings()
    HUD.settings = deepCopy(Config.Defaults)
    HUD.visible  = HUD.settings.hudEnabled
    HUD.SaveSettings()
    HUD.PushSettings()
end

--- Manda los ajustes actuales a la NUI para que se repinte todo.
function HUD.PushSettings()
    HUD.Send('settings', {
        settings = HUD.settings,
        config = {
            locale     = Config.Locale,
            currency   = Config.Money.currency,
            serverName = Config.Server.name,
            notify     = {
                position = Config.Notify.position,
                duration = Config.Notify.duration,
                maxStack = Config.Notify.maxStack,
            },
            labels = Locales[Config.Locale] or Locales['en'],
        },
    })
end

function HUD.Set(key, value)
    if HUD.settings[key] == nil then return end
    HUD.settings[key] = value
    HUD.SaveSettings()

    if key == 'hudEnabled' then
        HUD.visible = value
        HUD.Send('visible', { visible = value and not HUD.paused })
    end
end

--=====================================================================
--  MENU
--=====================================================================

function HUD.OpenSettings()
    if menuOpen then return end
    menuOpen = true
    SetNuiFocus(true, true)
    HUD.Send('openSettings', { settings = HUD.settings })
end

function HUD.CloseSettings()
    if not menuOpen then return end
    menuOpen = false
    SetNuiFocus(false, false)
    HUD.Send('closeSettings', {})
end

function HUD.IsMenuOpen() return menuOpen end

--=====================================================================
--  CALLBACKS NUI
--=====================================================================

RegisterNUICallback('ready', function(_, cb)
    HUD.FlushQueue()
    HUD.PushSettings()
    cb({ ok = true })
end)

RegisterNUICallback('close', function(_, cb)
    HUD.CloseSettings()
    cb({ ok = true })
end)

RegisterNUICallback('set', function(data, cb)
    if data and data.key ~= nil then
        HUD.Set(data.key, data.value)
    end
    cb({ ok = true })
end)

RegisterNUICallback('setAll', function(data, cb)
    if type(data) == 'table' and type(data.settings) == 'table' then
        for k, v in pairs(data.settings) do
            if HUD.settings[k] ~= nil and type(HUD.settings[k]) == type(v) then
                HUD.settings[k] = v
            end
        end
        HUD.visible = HUD.settings.hudEnabled
        HUD.SaveSettings()
    end
    cb({ ok = true })
end)

RegisterNUICallback('reset', function(_, cb)
    HUD.ResetSettings()
    HUD.Notify(L('settings_reset'), 'info')
    cb({ settings = HUD.settings })
end)

RegisterNUICallback('save', function(_, cb)
    HUD.SaveSettings()
    HUD.Notify(L('settings_saved'), 'success')
    cb({ ok = true })
end)

--=====================================================================
--  COMANDOS
--=====================================================================

CreateThread(function()
    HUD.LoadSettings()

    HUD.BindKey(Config.Commands.settings, L('settings_title'), Config.Keys.settings, function()
        if menuOpen then HUD.CloseSettings() else HUD.OpenSettings() end
    end)

    RegisterCommand(Config.Commands.toggle, function()
        HUD.Set('hudEnabled', not HUD.settings.hudEnabled)
        HUD.Notify(HUD.settings.hudEnabled and L('hud_enabled') or L('hud_disabled'), 'info')
    end, false)
end)

exports('OpenSettings', HUD.OpenSettings)
exports('GetSettings', function() return HUD.settings end)
