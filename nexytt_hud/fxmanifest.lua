fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name        'nexytt_hud'
author      'NEXYTT'
description 'HUD completo para FiveM (estilo Orbit) — bridge automatico ESX / QBCore / QBox / Standalone'
version     '1.0.0'

ui_page 'html/index.html'

shared_scripts {
    'config.lua',
    'locales/*.lua'
}

client_scripts {
    'bridge/client.lua',
    'client/utils.lua',
    'client/notify.lua',
    'client/settings.lua',
    'client/minimap.lua',
    'client/status.lua',
    'client/seatbelt.lua',
    'client/vehicle.lua',
    'client/voice.lua',
    'client/money.lua',
    'client/main.lua'
}

server_scripts {
    'bridge/server.lua',
    'server/main.lua'
}

files {
    'html/index.html',
    'html/css/*.css',
    'html/js/*.js'
}

dependencies {
    '/onesync'
}
