export type CardSearchResult = {
  boardId: string;
  boardTitle: string;
  columnId: string;
  columnTitle: string;
  cardId: string;
  cardTitle: string;
  cardDescription: string;
  completed: boolean;
}

export type CardSearchResponse = {
  results: CardSearchResult[];
}
