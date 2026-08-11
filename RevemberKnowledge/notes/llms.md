# LLMs

## Core idea

A large language model (LLM) generates text by repeatedly predicting the next token. A token can be a whole word, part of a word, punctuation, or whitespace. The model predicts one token, adds it to the context, predicts the next, and continues.

This is not the same as looking up an exact answer in a database or searching the internet for every token.

## How the ability is learned

During training, the model sees many examples and learns numerical parameters, also called weights, that make useful predictions more likely. A simplified training loop is:

1. Predict a token.
2. Measure the error.
3. Adjust the parameters slightly.
4. Repeat.

Gradient descent is a common name for this adjustment process. During ordinary inference, the trained parameters are usually fixed; the model uses them with the current prompt to generate tokens.

## From text to predictions

Neural-network calculations operate on numbers. A simplified internal pipeline is:

tokens -> numeric vectors -> many transformations -> probabilities for the next token

The vectors are learned numerical representations used by the network. They are not a stored answer for a word, and a token is not necessarily a complete word.

## Attention as a highlighter

Self-attention lets each token selectively use information from other tokens in the current context. For the sentence:

> The animal did not cross the street because it was tired.

attention can help the model relate it to the more likely referent animal rather than treating every surrounding token equally.

A useful mental model is a highlighter: each token can highlight relevant context and borrow information from it. Query, key, and value are names for roles in this lookup; the conceptual takeaway is selective context use.

## Multiple attention heads

Multiple heads are like several highlighters operating in parallel. One may emphasize grammar, another references, and another nearby or distant syntax. Their outputs are combined.

Multiple heads increase the number of relationship patterns the model can examine. They do not directly make the vocabulary larger.

## Current review focus

The foundation is established: next-token generation, learned parameters, training versus inference, and numerical representations. The next useful review is attention architecture, especially the difference between attention-head capacity and vocabulary size. Keep the highlighter analogy stable before introducing the dot-product and softmax equations.
