package greetings

import (
	"errors"
	"fmt"
)
// Hello returns a greeting for the named person
func Hello(name string) (string, error) {
	if name == "" {
		return "", errors.New("empty nam")
	}

	message := fmt.Sprintf("Hi, %v. Welcome!", name)
	return message, nil
}
