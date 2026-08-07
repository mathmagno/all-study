package mathdev.products.controller;

import mathdev.products.model.Produto;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;

@RestController
@RequestMapping("produtos")
public class ProdutoController {

    @PostMapping("/")
    public void salvar(Produto produto){
        System.out.println("Produto recebido: " + produto);
    }
}
