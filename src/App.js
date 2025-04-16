const { createYoga } = require('graphql-yoga');
const { createServer } = require('http');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const fs = require('fs');
const path = require('path');
const axios = require("axios");
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

// Set up LowDB (JSON file-based DB)
const dbFile = path.join(__dirname, 'db.json'); // Path to the database file
const defaultData = {} // Default data for the database

// Check if the database file exists, if not create it with default data
if (!fs.existsSync(dbFile)) {
    console.log("Database file not found. Creating a new one with default data...");
    // Create the default data if the file doesn't exist
    const defaultData = {
      users: [
        { id: '1', name: "Jan Konieczny", email: "jan.konieczny@wonet.pl", login: "jkonieczny" },
        { id: '2', name: "Anna Wesołowska", email: "anna.w@sad.gov.pl", login: "anna.wesolowska" },
        { id: '3', name: "Piotr Waleczny", email: "piotr.waleczny@gp.pl", login: "p.waleczny" }
      ],
      todos: [
        { id: '1', title: "Naprawić samochód", completed: false, user_id: '3' },
        { id: '2', title: "Posprzątać garaż", completed: true, user_id: '3' },
        { id: '3', title: "Napisać e-mail", completed: false, user_id: '3' },
        { id: '4', title: "Odebrać buty", completed: false, user_id: '2' },
        { id: '5', title: "Wysłać paczkę", completed: true, user_id: '2' },
        { id: '6', title: "Zamówic kuriera", completed: false, user_id: '3' },
      ]
    };
    // Write the default data to the database file
    fs.writeFileSync(dbFile, JSON.stringify(defaultData, null, 2));
}

// Create LowDB adapter and instance
const adapter = new JSONFile(dbFile); // Create a new JSON file adapter for LowDB
const db = new Low(adapter, defaultData); // Initialize the database with default data

// Load schema from file
// Instead of copying the schema to this file, we will load it from a separate file
// This is useful for larger schemas or when you want to keep the schema separate from the code
const typeDefs = fs.readFileSync(
    path.join(__dirname, 'schema.graphql'),
    'utf-8'
  );

// Generate ToDoID function to add a next number to the last ID in the database
const generateToDoId = async ()=> {
  await db.read();
  const todoIds = db.data.todos.map(t => parseInt(t.id));
  const maxId = Math.max(...todoIds);
  return (maxId + 1).toString();
}

//Generate UserID function to add a next number to the last ID in the database
const generateUserId = async ()=> {
  await db.read();
  const userIds = db.data.users.map(t => parseInt(t.id));
  const maxId = Math.max(...userIds);
  return (maxId + 1).toString();
}

// Function to get todo by ID from database
async function getTodoById(id) {
    try {
        await db.read(); // Read data from the database
        return db.data.todos.find(todo => todo.id == id); // Find, return todo by ID
    } catch (error) {
        throw error;
    }
}

// Function to get user by ID from database
async function getUserById(id) {
    try {
        await db.read(); // Read data from the database
        return db.data.users.find(user => user.id == id); // Find, return user by ID
    } catch (error) {
        throw error;
    }
}

// Function to get user by login from database
async function getUserByLogin(login) {
    try {
        await db.read(); // Read data from the database
        return db.data.users.find(user => user.login == login); // Find, return user by login
    } catch (error) {
        throw error;
    }
}

// Function to get todo by title from database
async function getUserTodoByTitle(title, userLogin) {
    try {
        await db.read(); // Read data from the database
        const user = db.data.users.find(user => user.login == userLogin); // Find user by login
        if (!user) {
            throw new Error(`User with login "${userLogin}" not found`);
        }
        return db.data.todos.find(t => t.title === title && t.user_id === user.id); // Find, return todo by name
    } catch (error) {
        throw error;
    }
}

// Create a new todo
async function createTodo(title, completed, userLogin) {
    try {
      await db.read();
      
      // Find user by login
      const user = db.data.users.find(u => u.login === userLogin);
      if (!user) {
        throw new Error(`User with login "${userLogin}" not found`);
      }
      
      // Check for duplicate title FOR THIS USER only
      const existingTodo = db.data.todos.find(t => 
        t.title === title && t.user_id === user.id
      );
      if (existingTodo) {
        throw new Error(`Todo with title "${title}" already exists for this user`);
      }
      
      const newId = await generateToDoId();
      const newTodo = {
        id: newId,
        title,
        completed: completed || false,
        user_id: user.id
      };
      
      db.data.todos.push(newTodo);
      await db.write();
      return newTodo;
    } catch (error) {
      throw error;
    }
}
  
// Update a todo by title and user
async function updateTodo(title, newTitle, completed, userLogin) {
    try {
      await db.read();
      
      // Find user by login
      const user = db.data.users.find(u => u.login === userLogin);
      if (!user) {
        throw new Error(`User with login "${userLogin}" not found`);
      }
      
      // Find todo by title AND user_id
      const todo = db.data.todos.find(t => 
        t.title === title && t.user_id === user.id
      );
      if (!todo) {
        throw new Error(`Todo with title "${title}" not found for user "${userLogin}"`);
      }
      
      // Update fields if provided
      if (newTitle) {
        // Check if new title already exists FOR THIS USER
        const existingTodo = db.data.todos.find(t => 
          t.title === newTitle && 
          t.id !== todo.id && 
          t.user_id === user.id
        );
        if (existingTodo) {
          throw new Error(`Todo with title "${newTitle}" already exists for this user`);
        }
        todo.title = newTitle;
      }
      
      if (completed !== undefined) {
        todo.completed = completed;
      }
      
      await db.write();
      return todo;
    } catch (error) {
      throw error;
    }
  }
  
// Delete a todo by title and user login
async function deleteTodo(title, userLogin) {
    try {
      await db.read();
      
      // Find user by login
      const user = db.data.users.find(u => u.login === userLogin);
      if (!user) {
        throw new Error(`User with login "${userLogin}" not found`);
      }
      
      const initialCount = db.data.todos.length;
      // Remove todos matching both title AND user_id
      db.data.todos = db.data.todos.filter(t => 
        !(t.title === title && t.user_id === user.id)
      );
      
      await db.write();
      return initialCount > db.data.todos.length;
    } catch (error) {
      throw error;
    }
  }
  
  async function toggleTodoCompleted(title, userLogin) {
    try {
      await db.read();
      
      // Find user by login
      const user = db.data.users.find(u => u.login === userLogin);
      if (!user) {
        throw new Error(`User with login "${userLogin}" not found`);
      }
      
      // Find todo by title AND user_id
      const todo = db.data.todos.find(t => 
        t.title === title && t.user_id === user.id
      );
      if (!todo) {
        throw new Error(`Todo with title "${title}" not found for user "${userLogin}"`);
      }
      
      todo.completed = !todo.completed;
      await db.write();
      return todo;
    } catch (error) {
      throw error;
    }
  }
  
  // Create new user
  async function createUser(name, email, login) {
    try {
      await db.read();
      
      // Check for duplicate login
      const existingUser = db.data.users.find(u => u.login === login);
      if (existingUser) {
        throw new Error(`User with login "${login}" already exists`);
      }
      
      const newId = await generateUserId();
      const newUser = {
        id: newId,
        name,
        email,
        login
      };
      
      db.data.users.push(newUser);
      await db.write();
      return newUser;
    } catch (error) {
      throw error;
    }
  }
  
  // Update user by login
  async function updateUser(login, name, email) {
    try {
      await db.read();
      
      // Find user by login
      const user = db.data.users.find(u => u.login === login);
      if (!user) {
        throw new Error(`User with login "${login}" not found`);
      }
      
      // Update fields if provided
      if (name) user.name = name;
      if (email) user.email = email;
      
      await db.write();
      return user;
    } catch (error) {
      throw error;
    }
  }
  
  // Delete user by login
  async function deleteUser(login) {
    try {
      await db.read();
      const user = db.data.users.find(u => u.login === login);
      if (!user) {
        throw new Error(`User with login "${login}" not found`);
      }
      
      // Delete user and their todos
      const userId = user.id;
      db.data.todos = db.data.todos.filter(t => t.user_id !== userId);
      db.data.users = db.data.users.filter(u => u.login !== login);
      
      await db.write();
      return true;
    } catch (error) {
      throw error;
    }
  }


// Function to get users from database
async function getUsersList(){
    try {
        await db.read(); // Read data from the database
        return db.data.users; // Return the todos from the database
    } catch (error) {
        throw error;
    }
}

// New function to get todos from database
async function getTodosList() {
    try {
        await db.read(); // Read data from the database
        return db.data.todos; // Return the todos from the database
    } catch (error) {
        throw error;
    }
}

// Resolvers
const resolvers = {
    Query: {
      demo: () => 'Witaj, GraphQL działa!',
      users: async () => getUsersList(),
      todos: async () => getTodosList(),
      user: async (_, { login }) => getUserByLogin(login),
      todo: async (_, { title, userLogin }) => getUserTodoByTitle(title, userLogin),
      userById: async (_, { id }) => getUserById(id),
      todoById: async (_, { id }) => getTodoById(id),
    },
    Mutation: {
        createTodo: async (_, { title, completed, userLogin }) => {
            if (!userLogin) {
                throw new Error("User login is required to create a todo");
              }
          return createTodo(title, completed, userLogin);
        },
        updateTodo: async (_, { title, newTitle, completed, userLogin }) => {
            if (!userLogin) {
                throw new Error("User login is required to update a specific todo");
              }
          return updateTodo(title, newTitle, completed, userLogin);
        },
        deleteTodo: async (_, { title, userLogin }) => {
            if (!userLogin) {
                throw new Error("User login is required to delete a specific todo");
              }
          return deleteTodo(title, userLogin);
        },
        toggleTodoCompleted: async (_, { title, userLogin }) => {
            if (!userLogin) {
                throw new Error("User login is required to toggle the todo");
              }
          return toggleTodoCompleted(title, userLogin);
        },
        createUser: async (_, { name, email, login }) => {
          return createUser(name, email, login);
        },
        updateUser: async (_, { login, name, email }) => {
          return updateUser(login, name, email);
        },
        deleteUser: async (_, { login }) => {
          return deleteUser(login);
        },
        getUserByLogin: async (_, { login }) => {
          return getUserByLogin(login);
        }
      },
      
      User: {
        todos: async (parent) => {
          await db.read();
          return db.data.todos.filter(todo => todo.user_id === parent.id);
        }
      },
      
      ToDoItem: {
        user: async (parent) => {
          await db.read();
          return db.data.users.find(user => user.id === parent.user_id);
        }
      }
  };

// Create executable schema
const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

// Create Yoga instance (GraphQL server)
const yoga = createYoga({
  schema,
  graphiql: true, // Enable GraphiQL UI
  context: ({ request }) => {
    return { db };
  }
});

// Create HTTP server
const server = createServer(yoga);

// Start the server
server.listen(4000, () => {
  console.log('Server is running on http://localhost:4000/graphql');
});