Esta aplicação conecta o navegador ao PicJoyBridgeServer para enviar fotos ao Kiosk do PicJoy. Saiba mais em https://picjoy.com.br/.

## Envio confirmado — protocolo 2

O uploader novo exige Bridge e Kiosk com suporte a `protocolVersion: 2`. A seleção não tem teto comercial por MB, por arquivo ou por lote. A quantidade é limitada ao menor valor entre 100 e o saldo confirmado de impressão informado pelo Kiosk. Fotos com nomes iguais são independentes: o manifesto usa `fileId` próprio e o lote usa `transferId`.

O QR Code do totem acrescenta `uploadTicket` à URL. A consulta existente `GET /session/:code/:customerId` recebe esse parâmetro; o registro WebSocket vincula a permissão ao mesmo cliente. A permissão tem uso único e prazo de 10 minutos para iniciar. Sucesso, erro, desconexão ou nova sessão no totem impedem reutilização. Voltar ao totem e reler o QR inicia outro processo; não há retomada automática de um lote parcial.

O arquivo é lido com `File.slice()`, em blocos de até 48 KiB. Cada bloco leva SHA-256 e aguarda confirmação do Kiosk antes da leitura do próximo. Repetições usam a mesma requisição; não significam novo bloco. O progresso por foto indica recebimento confirmado. Depois de recebidas todas, a página informa que está aguardando o preparo do lote.

## Encerramento após o envio

A conclusão e o fechamento do WebSocket só ocorrem após o ACK final do Kiosk, emitido depois do preparo das imagens e backups. Após o close limpo, tenta `window.close()`; se a aba continuar aberta, usa `location.replace('https://picjoyclub.com')`, saindo de `https://uploader.picjoy.com.br`. O fallback entre domínios é preservado.

Falha, timeout, processamento recusado ou desconexão não fecham a aba por sucesso nem reconectam o cliente com a permissão consumida. Fechar a aba não apaga entradas antigas do histórico; a proteção do fluxo novo também depende da revogação da permissão no Bridge. As restrições de fechamento são documentadas em [Window.close — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/close).

## Compatibilidade e validação

Publicar Bridge, Kiosk e Uploader nessa ordem, coordenando a troca dos clientes. O Bridge mantém o protocolo 1 para pares antigos. O uploader novo recusa modo sem ACK ou totem incompatível, com erro visível, em vez de anunciar recebimento sem confirmação. Reverter somente o Bridge para uma versão antiga é incompatível com os clientes novos.

Os limites de bytes não homologam sozinhos 100 fotos: a memória e o processamento do Kiosk continuam na etapa 3. A validação de resolução também continua pendente nessa etapa.

- `npm run test:upload`: regressões do fluxo real da tela e do envio em blocos.
- `npm run build`: tipos oficiais de Vue e bundle. A declaração vazia `declare module "vue"` foi removida na correção anterior dos erros TS2347.

O contrato coordenado e os resultados locais estão em `PicJoyKioskApp/api-documentation.md` e `PicJoyKioskApp/docs/analisis/`.

## Saldo de impressão

O registro v2 precisa informar `printCapacity.maxFiles` e `uploadLimits.maxFiles`. Saldo zero, desconhecido ou servidor sem essa confirmação impede o envio. O limite aparece antes de enviar as fotos; excedê-lo é recusado antes de ler os arquivos. O Bridge impõe o mesmo teto ao manifesto.

O Kiosk consulta o SDK da ASK-400, ou a contabilidade para outras impressoras, ao abrir a permissão. Revalida ao iniciar e ao concluir o lote. O upload não reserva estoque fisicamente; cópias, formatos e impressão final seguem as verificações da aplicação.

Blocos de 48 KiB, frames de 128 KiB e janela global continuam limitando a memória do transporte. Os campos antigos de bytes permanecem por compatibilidade, usando o maior inteiro exato do JavaScript para validar metadados, sem os tetos anteriores de 20 MiB/2 GiB.
