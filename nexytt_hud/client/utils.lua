--=====================================================================
--  UTILIDADES COMPARTIDAS DEL CLIENTE
--=====================================================================

HUD = {
    visible   = true,   -- el HUD esta activo (toggle del jugador)
    paused    = false,  -- oculto temporalmente (pausa, cinematic, muerte)
    nuiReady  = false,
    settings  = {},
}

local pending = {}

--- Envia un mensaje a la NUI. Antes de que el DOM avise que esta listo
--- los mensajes se encolan para no perderlos en el arranque.
function HUD.Send(action, data)
    local payload = data or {}
    payload.action = action

    if not HUD.nuiReady then
        pending[#pending + 1] = payload
        return
    end
    SendNUIMessage(payload)
end

function HUD.FlushQueue()
    HUD.nuiReady = true
    for _, msg in ipairs(pending) do SendNUIMessage(msg) end
    pending = {}
end

--- Redondea a `decimals` decimales.
function HUD.Round(value, decimals)
    local mult = 10 ^ (decimals or 0)
    return math.floor(value * mult + 0.5) / mult
end

function HUD.Clamp(v, min, max)
    if v < min then return min end
    if v > max then return max end
    return v
end

--- Interpolacion suave usada para que las barras no salten de golpe.
function HUD.Lerp(from, to, alpha)
    return from + (to - from) * alpha
end

--- Formato de dinero: 1234567 -> 1.234.567
function HUD.FormatMoney(amount)
    local formatted = tostring(math.floor(math.abs(amount or 0)))
    while true do
        local replaced
        formatted, replaced = formatted:gsub('^(-?%d+)(%d%d%d)', '%1.%2')
        if replaced == 0 then break end
    end
    if (amount or 0) < 0 then formatted = '-' .. formatted end
    return formatted
end

--- true si el jugador esta en pausa, muerto o en una cinematica
function HUD.ShouldHide()
    if IsPauseMenuActive() then return true end
    if IsPlayerSwitchInProgress() then return true end
    if IsScreenFadedOut() then return true end
    return false
end

--- Registra un comando + keymapping opcional en una sola llamada.
function HUD.BindKey(command, description, key, handler)
    RegisterCommand(command, handler, false)
    if key and key ~= '' then
        RegisterKeyMapping(command, description, 'keyboard', key)
    end
end

--- Devuelve la clase del vehiculo de forma segura
function HUD.VehicleClass(veh)
    if not veh or veh == 0 or not DoesEntityExist(veh) then return -1 end
    return GetVehicleClass(veh)
end

function HUD.TableContains(tbl, value)
    for _, v in ipairs(tbl or {}) do
        if v == value then return true end
    end
    return false
end
