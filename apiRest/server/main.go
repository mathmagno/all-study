package main

import (
	"log"
	"net/http"
)

func main() {
    log.Println("Servidor iniciado em http://localhost:8080")

	err := http.ListenAndServe(":8080", nil)
	if err != nil {
		log.Fatal("Erro ao iniciar o servidor: ", err)
	}
}
