# go_definitve

Repositório de configuração e estudos com instância AWS Lightsail.

## Acesso SSH à Lightsail

Para configurar o acesso em uma **nova máquina**, siga o guia:

**[docs/setup-lightsail-ssh.md](docs/setup-lightsail-ssh.md)**

### Resumo

1. Clone este repositório (privado no GitHub)
2. Copie manualmente a chave `LightsailDefaultKey-sa-east-1.pem` para a pasta do repo
3. Configure o SSH (`ssh/config.example` ou script `scripts/setup-ssh-windows.ps1`)
4. Conecte pelo Cursor com Remote SSH → host `lightsail`

> A chave `.pem` não é versionada no Git por segurança.
