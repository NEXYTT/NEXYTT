--=====================================================================
--  ARMA EQUIPADA Y MUNICION
--=====================================================================

local UNARMED = GetHashKey('WEAPON_UNARMED')
local last = { hash = 0, clip = -1, total = -1 }

local function push(visible, data)
    HUD.Send('weapon', data and data or { visible = visible })
end

CreateThread(function()
    while true do
        local wait = 300

        if HUD.visible and not HUD.paused and HUD.settings.showWeapon then
            local ped  = PlayerPedId()
            local hash = GetSelectedPedWeapon(ped)

            if hash and hash ~= UNARMED and hash ~= 0 and HasPedGotWeapon(ped, hash, false) then
                local total = GetAmmoInPedWeapon(ped, hash) or 0
                local _, clip = GetAmmoInClip(ped, hash)
                clip = clip or 0

                -- Las armas cuerpo a cuerpo no tienen munición: solo icono
                local melee = total == 0 and clip == 0

                if hash ~= last.hash or clip ~= last.clip or total ~= last.total then
                    last.hash, last.clip, last.total = hash, clip, total

                    push(true, {
                        visible = true,
                        label   = Bridge.GetWeaponLabel(hash),
                        clip    = clip,
                        reserve = math.max(0, total - clip),
                        melee   = melee,
                        low     = (not melee) and clip > 0 and clip <= 5,
                        empty   = (not melee) and total == 0,
                    })
                end
                wait = 150
            elseif last.hash ~= 0 then
                last.hash, last.clip, last.total = 0, -1, -1
                push(false)
            end
        elseif last.hash ~= 0 then
            last.hash = 0
            push(false)
        end

        Wait(wait)
    end
end)
