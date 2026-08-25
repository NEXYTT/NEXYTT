--=====================================================================
--  VOZ Y RADIO
--  Integracion con pma-voice; si no esta, cae a los natives de mumble.
--=====================================================================

HUD.talking = false

local voice = { range = 2, label = '', radio = 0, talking = false, radioTalking = false }

local function hasPma()
    return GetResourceState(Config.Resources.voice) == 'started'
end

local function rangeLabel(index)
    local labels = Config.Voice.ranges
    return labels[index] or labels[2] or ''
end

local function readVoice()
    local playerId = PlayerId()

    if hasPma() then
        local prox = LocalPlayer.state.proximity
        if type(prox) == 'table' and prox.index then
            voice.range = prox.index
        end

        local channel = LocalPlayer.state.radioChannel
        voice.radio = (type(channel) == 'number' and channel > 0) and channel or 0

        voice.radioTalking = LocalPlayer.state.radioActive == true
    else
        -- Sin pma-voice mapeamos la distancia de mumble a 3 tramos
        local dist = MumbleGetTalkerProximity()
        if     dist <= 3.0  then voice.range = 1
        elseif dist <= 10.0 then voice.range = 2
        else                     voice.range = 3 end
        voice.radio = 0
    end

    voice.label   = rangeLabel(voice.range)
    voice.talking = MumbleIsPlayerTalking(playerId) or NetworkIsPlayerTalking(playerId)
    HUD.talking   = voice.talking
end

CreateThread(function()
    if not Config.Voice.enabled then return end

    while true do
        local wait = Config.Tick.normal

        if HUD.visible and not HUD.paused and HUD.settings.showVoice then
            readVoice()
            HUD.Send('voice', {
                visible      = true,
                range        = voice.range,
                label        = voice.label,
                talking      = voice.talking,
                radio        = Config.Voice.showRadio and voice.radio or 0,
                radioTalking = voice.radioTalking,
            })
        else
            HUD.Send('voice', { visible = false })
            wait = 600
        end

        Wait(wait)
    end
end)

exports('GetVoiceData', function()
    return { range = voice.range, label = voice.label, radio = voice.radio, talking = voice.talking }
end)
