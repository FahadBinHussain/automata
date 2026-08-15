package main

import (
	"fmt"
	"net"
	"os"

	"github.com/armon/go-socks5"
)

func main() {
	bind := os.Args[1]
	conf := &socks5.Config{}
	if user := os.Getenv("SOCKS5_USER"); user != "" {
		pass := os.Getenv("SOCKS5_PASS")
		creds := socks5.StaticCredentials{user: pass}
		conf = &socks5.Config{Credentials: creds}
	}
	server, err := socks5.New(conf)
	if err != nil {
		fmt.Println("new:", err)
		os.Exit(1)
	}
	ln, err := net.Listen("tcp", bind)
	if err != nil {
		fmt.Println("listen:", err)
		os.Exit(1)
	}
	fmt.Println("socks5 listening on", bind)
	for {
		conn, err := ln.Accept()
		if err != nil {
			fmt.Println("accept:", err)
			continue
		}
		remote := conn.RemoteAddr().String()
		fmt.Println("accepted from", remote)
		go func() {
			defer conn.Close()
			server.ServeConn(conn)
		}()
	}
}