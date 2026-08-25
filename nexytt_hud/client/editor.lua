--=====================================================================
--  EDITOR DE POSICION (drag-anywhere)
--  Deja mover cada bloque del HUD por la pantalla y guarda el resultado
--  por jugador. Las posiciones van en % para que sirvan en cualquier
--  resolucion.
--=====================================================================

Editor = { open = false }

function Editor.Open()
    if Editor.open then return end
    Editor.open = true

    SetNuiFocus(true, true)
    HUD.Send('editor', {
        open      = true,
        positions = HUD.settings.positions or {},
    })
end

function Editor.Close()
    if not Editor.open then return end
    Editor.open = false
    SetNuiFocus(false, false)
    HUD.Send('editor', { open = false })
end

function Editor.Toggle()
    if Editor.open then Editor.Close() else Editor.Open() end
end

--=====================================================================
--  CALLBACKS
--=====================================================================

RegisterNUICallback('savePositions', function(data, cb)
    local positions = {}

    -- Nos quedamos solo con pares numericos validos: la NUI no decide
    -- que se guarda en KVP.
    if type(data) == 'table' and type(data.positions) == 'table' then
        for key, pos in pairs(data.positions) do
            if type(key) == 'string' and type(pos) == 'table'
               and type(pos.x) == 'number' and type(pos.y) == 'number' then
                positions[key] = {
                    x = HUD.Clamp(pos.x, -5.0, 105.0),
                    y = HUD.Clamp(pos.y, -5.0, 105.0),
                }
            end
        end
    end

    HUD.settings.positions = positions
    HUD.SaveSettings()

    Editor.Close()
    HUD.Notify(L('editor_saved'), 'success', 2500)
    cb({ ok = true })
end)

RegisterNUICallback('closeEditor', function(_, cb)
    Editor.Close()
    cb({ ok = true })
end)

RegisterNUICallback('resetPositions', function(_, cb)
    HUD.settings.positions = {}
    HUD.SaveSettings()
    HUD.Notify(L('editor_reset'), 'info', 2500)
    cb({ positions = {} })
end)

RegisterNUICallback('openEditor', function(_, cb)
    Editor.Open()
    cb({ ok = true })
end)

--=====================================================================
--  ENTRADA
--=====================================================================

CreateThread(function()
    HUD.BindKey(Config.Commands.editor, L('editor_title'), Config.Keys.editor, function()
        Editor.Toggle()
    end)
end)

exports('OpenEditor', Editor.Open)
