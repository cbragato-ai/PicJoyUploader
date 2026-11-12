# PicJoy Uploader

Esta aplicação se dedica a conexão com o servidor de WebSocket para enviar fotos para o Kiosk do PicJoy, para tratamento e impressão.

Saiba mais em https://picjoy.com.br/

## Encerramento após o envio

Após enviar todos os arquivos sem erro e a notificação `transfer_complete`, o uploader encerra o WebSocket e impede reconexões. Quando o fechamento da conexão é confirmado sem erro, tenta fechar a aba do navegador. Caso o navegador bloqueie `window.close()` (por exemplo, em uma aba aberta por QR Code), redireciona de `https://uploader.picjoy.com.br` para `https://picjoyclub.com` usando `location.replace()`, retirando o uploader e o código do totem da aba atual. A URL absoluta permite a navegação entre os domínios.

Lotes com falha permanecem na página e não enviam a notificação de conclusão. O botão Enviar fica bloqueado durante o envio para impedir lotes duplicados. O protocolo atual ainda não confirma o recebimento/processamento pelo totem; essa evolução está descrita no relatório de análise do PicJoyKioskApp.

O fechamento é uma proteção local. Ele não revoga o endereço do QR Code no servidor nem remove entradas anteriores do histórico do navegador. A restrição do navegador está documentada em [Window.close() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/close).

Validação automatizada: `npm run test:upload`.
