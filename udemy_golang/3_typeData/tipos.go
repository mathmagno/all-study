package main

import (
	"errors"
	"fmt"
)

func main() {

	// int8, int16, int32, int64 // 8, 16, 32, 64 bits
	// uint8, uint16, uint32, uint64 // 8, 16, 32, 64 bits
	// float32, float64 // 32, 64 bits
	// complex64, complex128 // 64, 128 bits
	// bool // true, false
	// string // "Hello, World!"
	// byte // 8 bits
	// rune // 32 bits
	// error // error

	var numero int64 = 1000000000000000000
	fmt.Println(numero)

	var numero2 uint32 = 100000
	fmt.Println(numero2)

	// alias
	// INT32 = rune
	var numero3 rune = 12456
	fmt.Println(numero3)

	var numero4 byte = 123
	fmt.Println(numero4)

	var numeroReal1 float32 = 123.45
	fmt.Println(numeroReal1)

	var numeroReal2 float64 = 12300000000.45
	fmt.Println(numeroReal2)

	numeroReal3 := 1234567890.45
	fmt.Println(numeroReal3)

	// FIM NÚMEROS REAIS

	// STRINGS

	var str string = "Olá, Mundo!"
	fmt.Println(str)

	str2 := "texto 2"
	fmt.Println(str2)

	char := 'A'
	fmt.Println(char)

	// FIM STRINGS

	texto := 5
	fmt.Println(texto)

	var booleano1 bool = true
	fmt.Println(booleano1)

	var erro error = errors.New("erro ao abrir arquivo")
	fmt.Println(erro)
}
