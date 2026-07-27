# Fontes empacotadas

`InterVariable.ttf` — Inter, licenciada sob a SIL Open Font License 1.1
(https://github.com/rsms/inter). O empacotamento e a redistribuição embutida
são permitidos pela OFL.

**Por que a fonte está versionada no repositório e não vem do sistema:**
o gerador antigo do orçamento pedia `'Segoe UI', Tahoma, Geneva, Verdana`
— nenhuma delas existe na imagem de produção (que traz apenas `ttf-freefont`),
e Segoe UI é proprietária da Microsoft. O resultado é que o mesmo "documento"
paginava diferente conforme o sistema operacional de quem imprimia.

Um documento assinado não pode depender da resolução de fontes do host. A fonte
é embutida como data-URI no HTML de render, então o PDF congelado é idêntico na
máquina de desenvolvimento, no container e em qualquer futura reinstalação.
