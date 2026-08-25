--=====================================================================
--  DINERO
--  Muestra efectivo / banco / dinero negro y anima el +/- al cambiar.
--=====================================================================

local last = { cash = nil, bank = nil, black = nil }

local function push(force)
    if not Config.Money.enabled or not HUD.settings.showMoney then
        HUD.Send('money', { visible = false })
        return
    end

    local cash  = Bridge.GetCash()
    local bank  = Bridge.GetBank()
    local black = Bridge.GetBlack()

    local changes = {}
    if last.cash  and cash  ~= last.cash  then changes.cash  = cash  - last.cash  end
    if last.bank  and bank  ~= last.bank  then changes.bank  = bank  - last.bank  end
    if last.black and black ~= last.black then changes.black = black - last.black end

    local changed = next(changes) ~= nil
    if not changed and not force and last.cash ~= nil then return end

    last.cash, last.bank, last.black = cash, bank, black

    HUD.Send('money', {
        visible    = true,
        currency   = Config.Money.currency,
        cash       = Config.Money.showCash  and HUD.FormatMoney(cash)  or nil,
        bank       = Config.Money.showBank  and HUD.FormatMoney(bank)  or nil,
        black      = Config.Money.showBlack and HUD.FormatMoney(black) or nil,
        changes    = changes,
        changeTime = Config.Money.changeTime,
        standalone = Bridge.name == 'standalone',
    })
end

CreateThread(function()
    Wait(2000)
    while true do
        if HUD.visible and not HUD.paused then
            -- ESX no dispara evento al cambiar el efectivo: refrescamos aca.
            if Bridge.RefreshMoney then Bridge.RefreshMoney() end
            push(false)
        end
        Wait(Config.Tick.slow)
    end
end)

CreateThread(function()
    Wait(1500)
    Bridge.On('money',  function() push(false) end)
    Bridge.On('loaded', function() push(true)  end)
end)

exports('RefreshMoney', function() push(true) end)
