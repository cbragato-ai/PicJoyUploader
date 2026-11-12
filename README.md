# PicJoy Uploader

Esta aplicação se dedica a conexão com o servidor de WebSocket para enviar fotos para o Kiosk do PicJoy, para tratamento e impressão.

Saiba mais em https://picjoy.com.br/

## Encerramento após o envio

Após enviar todos os arquivos sem erro e a notificação `transfer_complete`, o uploader encerra o WebSocket e impede reconexões. Quando o fechamento da conexão é confirmado sem erro, tenta fechar a aba do navegador. Caso o navegador bloqueie `window.close()` (por exemplo, em uma aba aberta por QR Code), redireciona de `https://uploader.picjoy.com.br` para `https://picjoyclub.com` usando `location.replace()`, retirando o uploader e o código do totem da aba atual. A URL absoluta permite a navegação entre os domínios.

Lotes com falha permanecem na página e não enviam a notificação de conclusão. O botão Enviar fica bloqueado durante o envio para impedir lotes duplicados. O protocolo atual ainda não confirma o recebimento/processamento pelo totem; essa evolução está descrita no relatório de análise do PicJoyKioskApp.

O fechamento é uma proteção local. Ele não revoga o endereço do QR Code no servidor nem remove entradas anteriores do histórico do navegador. A restrição do navegador está documentada em [Window.close() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/close).

Validação automatizada: `npm run test:upload`.

## Contenção do envio — etapa 1

O uploader valida a seleção antes de ler as fotos: até 100 arquivos, 20 MiB por arquivo e 2 GiB por lote. Arquivos vazios ou com nomes repetidos são recusados. O limite de resolução será tratado nas próximas etapas de processamento.

O registro anuncia `protocolVersion: 1`. O Bridge atualizado responde com `registered`, a versão e `uploadLimits`; o uploader aguarda esse registro para liberar o envio. Os limites anunciados podem reduzir os tetos locais. Um Bridge antigo que responde sem versão permanece compatível, usando os tetos locais do uploader, sem garantia de validação no servidor antigo.

Mensagens `transfer-error` interrompem o envio, exibem o erro e impedem sucesso, redirecionamento e reconexão automática. O protocolo desta etapa continua sem ACK de recebimento por arquivo ou lote e sem controle de bytes em voo; os limites não representam homologação de 100 fotos em produção.
