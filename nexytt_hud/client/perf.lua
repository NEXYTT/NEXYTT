--=====================================================================
--  RENDIMIENTO: FPS Y PING
--=====================================================================

Perf = { fps = 0, ping = 0 }

-- GetFrameTime() devuelve la duracion del ultimo frame, asi que no hace
-- falta un bucle a Wait(0) para medir: muestreamos y suavizamos.
CreateThread(function()
    local smoothed = 60.0

    while true do
        Wait(120)

        local frameTime = GetFrameTime()
        if frameTime and frameTime > 0.0 then
            smoothed = smoothed * 0.78 + (1.0 / frameTime) * 0.22
            Perf.fps = math.floor(smoothed + 0.5)
        end
    end
end)

CreateThread(function()
    while true do
        Wait(2000)
        Perf.ping = GetPlayerPing(PlayerId()) or 0
    end
end)

exports('GetPerf', function() return Perf.fps, Perf.ping end)
