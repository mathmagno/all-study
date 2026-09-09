'use client';

import Image from 'next/image';
import { SyntheticEvent, useMemo, useState } from 'react';
import { ArrowRight, MapPin, Orbit, Search, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Character = {
  id: number;
  name: string;
  status: 'Alive' | 'Dead' | 'unknown';
  species: string;
  gender: string;
  origin: string;
  location: string;
  image: string;
  episodes: number;
};

const characters: Character[] = [
  { id: 1, name: 'Rick Sanchez', status: 'Alive', species: 'Human', gender: 'Male', origin: 'Earth (C-137)', location: 'Citadel of Ricks', image: 'https://rickandmortyapi.com/api/character/avatar/1.jpeg', episodes: 51 },
  { id: 2, name: 'Morty Smith', status: 'Alive', species: 'Human', gender: 'Male', origin: 'unknown', location: 'Citadel of Ricks', image: 'https://rickandmortyapi.com/api/character/avatar/2.jpeg', episodes: 51 },
  { id: 3, name: 'Summer Smith', status: 'Alive', species: 'Human', gender: 'Female', origin: 'Earth (Replacement Dimension)', location: 'Earth (Replacement Dimension)', image: 'https://rickandmortyapi.com/api/character/avatar/3.jpeg', episodes: 42 },
];

export default function Home() {
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('Rick Sanchez');

  const result = useMemo(() => {
    const term = searchTerm.trim().toLocaleLowerCase('pt-BR');
    if (!term) return null;
    return characters.find((character) => character.name.toLocaleLowerCase('pt-BR').includes(term)) ?? null;
  }, [searchTerm]);

  function searchCharacter(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchTerm(query);
  }

  function selectSuggestion(name: string) {
    setQuery(name);
    setSearchTerm(name);
  }

  return (
    <main className="app-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Portal API — início">
          <span className="brand-mark"><Orbit aria-hidden="true" /></span>
          <span>PORTAL<span className="brand-accent">API</span></span>
        </a>
        <p className="api-status"><span aria-hidden="true" /> API online</p>
      </header>

      <section className="workspace" id="top">
        <div className="intro">
          <p className="eyebrow"><Sparkles aria-hidden="true" /> ARQUIVO INTERDIMENSIONAL</p>
          <h1>Quem você está<br />procurando?</h1>
          <p className="intro-copy">Busque um personagem pelo nome e consulte seus dados conhecidos.</p>
        </div>

        <form className="search-form" onSubmit={searchCharacter}>
          <Search className="search-icon" aria-hidden="true" />
          <Input aria-label="Nome do personagem" className="search-input" onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: Rick Sanchez" type="search" value={query} />
          <Button className="search-button" size="lg" type="submit">Buscar <ArrowRight aria-hidden="true" /></Button>
        </form>

        <div className="suggestions" aria-label="Sugestões de busca">
          <span>Tente buscar:</span>
          {characters.map((character) => <button key={character.id} onClick={() => selectSuggestion(character.name)} type="button">{character.name.split(' ')[0]}</button>)}
        </div>

        <section className="result-area" aria-live="polite">
          <div className="result-heading">
            <p>RESULTADO DA BUSCA</p>
            <span>{result ? '1 personagem encontrado' : 'Nenhum personagem encontrado'}</span>
          </div>
          {result ? <CharacterCard character={result} /> : <EmptyResult term={searchTerm} />}
        </section>
      </section>

      <footer>
        <span>Dados para estudo</span>
        <a href="https://rickandmortyapi.com/" rel="noreferrer" target="_blank">Rick and Morty API <ArrowRight aria-hidden="true" /></a>
      </footer>
    </main>
  );
}

function CharacterCard({ character }: { character: Character }) {
  const statusClass = character.status.toLowerCase();
  const statusLabel = character.status === 'Alive' ? 'Vivo' : character.status === 'Dead' ? 'Morto' : 'Desconhecido';

  return (
    <article className="character-card">
      <div className="portrait-wrap">
        <Image alt={`Retrato de ${character.name}`} height={300} priority src={character.image} width={300} />
        <span className="record-id">ID #{String(character.id).padStart(3, '0')}</span>
      </div>
      <div className="character-content">
        <div className="character-title">
          <div><p className="record-label">REGISTRO DE PERSONAGEM</p><h2>{character.name}</h2></div>
          <span className={`status-badge ${statusClass}`}><i aria-hidden="true" /> {statusLabel}</span>
        </div>
        <dl className="character-data">
          <div><dt>Espécie</dt><dd>{character.species}</dd></div>
          <div><dt>Gênero</dt><dd>{character.gender === 'Male' ? 'Masculino' : 'Feminino'}</dd></div>
          <div><dt>Episódios</dt><dd>{character.episodes}</dd></div>
        </dl>
        <div className="location-row">
          <MapPin aria-hidden="true" />
          <div><span>ÚLTIMA LOCALIZAÇÃO CONHECIDA</span><strong>{character.location}</strong></div>
        </div>
        <p className="origin">Origem: <strong>{character.origin}</strong></p>
      </div>
    </article>
  );
}

function EmptyResult({ term }: { term: string }) {
  return (
    <div className="empty-result">
      <Search aria-hidden="true" />
      <h2>Nenhum registro localizado</h2>
      <p>Não encontramos “{term || 'sua busca'}” nos dados simulados. Tente Rick, Morty ou Summer.</p>
    </div>
  );
}
