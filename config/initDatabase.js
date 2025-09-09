const { pool, executeQuery } = require('./database');
const bcrypt = require('bcryptjs');

// Create all tables
const createTables = async () => {
  try {
    console.log('📊 Creating database tables...');
    
    // Users table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('customer', 'admin') DEFAULT 'customer',
        phone VARCHAR(20),
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(100),
        zip_code VARCHAR(20),
        birthdate DATE,
        status ENUM('active', 'inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_role (role),
        INDEX idx_status (status)
      )
    `);

    // Categories table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        status ENUM('active', 'inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_name (name),
        INDEX idx_status (status)
      )
    `);

    // Products table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS products (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        original_price DECIMAL(10,2),
        category_id INT NOT NULL,
        stock INT DEFAULT 0,
        rating DECIMAL(3,2) DEFAULT 0.00,
        reviews_count INT DEFAULT 0,
        badge VARCHAR(50),
        status ENUM('active', 'inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
        INDEX idx_name (name),
        INDEX idx_category (category_id),
        INDEX idx_price (price),
        INDEX idx_status (status),
        INDEX idx_rating (rating)
      )
    `);

    // Product images table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS product_images (
        id INT PRIMARY KEY AUTO_INCREMENT,
        product_id INT NOT NULL,
        image_url VARCHAR(500) NOT NULL,
        is_primary BOOLEAN DEFAULT FALSE,
        display_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        INDEX idx_product (product_id),
        INDEX idx_primary (is_primary),
        INDEX idx_order (display_order)
      )
    `);

    // Product specifications table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS product_specifications (
        id INT PRIMARY KEY AUTO_INCREMENT,
        product_id INT NOT NULL,
        spec_key VARCHAR(100) NOT NULL,
        spec_value TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        INDEX idx_product (product_id),
        INDEX idx_key (spec_key)
      )
    `);

    // Product features table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS product_features (
        id INT PRIMARY KEY AUTO_INCREMENT,
        product_id INT NOT NULL,
        feature_text TEXT NOT NULL,
        display_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        INDEX idx_product (product_id),
        INDEX idx_order (display_order)
      )
    `);

    // Orders table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT PRIMARY KEY AUTO_INCREMENT,
        order_number VARCHAR(50) UNIQUE NOT NULL,
        user_id INT NOT NULL,
        status ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled') DEFAULT 'pending',
        subtotal DECIMAL(10,2) NOT NULL,
        shipping_cost DECIMAL(10,2) DEFAULT 0.00,
        tax_amount DECIMAL(10,2) DEFAULT 0.00,
        total_amount DECIMAL(10,2) NOT NULL,
        shipping_address TEXT NOT NULL,
        shipping_city VARCHAR(100) NOT NULL,
        shipping_state VARCHAR(100) NOT NULL,
        shipping_zip_code VARCHAR(20) NOT NULL,
        shipping_method VARCHAR(100) DEFAULT 'Standard Delivery',
        delivery_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
        INDEX idx_order_number (order_number),
        INDEX idx_user (user_id),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at)
      )
    `);

    // Order items table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INT PRIMARY KEY AUTO_INCREMENT,
        order_id INT NOT NULL,
        product_id INT NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        product_price DECIMAL(10,2) NOT NULL,
        quantity INT NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
        INDEX idx_order (order_id),
        INDEX idx_product (product_id)
      )
    `);

    // Payments table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT PRIMARY KEY AUTO_INCREMENT,
        order_id INT NOT NULL,
        payment_method VARCHAR(100) NOT NULL,
        transaction_id VARCHAR(255),
        amount DECIMAL(10,2) NOT NULL,
        status ENUM('pending', 'completed', 'failed', 'refunded') DEFAULT 'pending',
        payment_details JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        INDEX idx_order (order_id),
        INDEX idx_transaction (transaction_id),
        INDEX idx_status (status)
      )
    `);

    // Wishlist table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS wishlist (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        product_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_product (user_id, product_id),
        INDEX idx_user (user_id),
        INDEX idx_product (product_id)
      )
    `);

    // Product reviews table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS product_reviews (
        id INT PRIMARY KEY AUTO_INCREMENT,
        product_id INT NOT NULL,
        user_id INT NOT NULL,
        rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
        review_text TEXT,
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_product_review (user_id, product_id),
        INDEX idx_product (product_id),
        INDEX idx_user (user_id),
        INDEX idx_rating (rating),
        INDEX idx_status (status)
      )
    `);

    // Cart sessions table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS cart_sessions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        user_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_session (session_id),
        INDEX idx_user (user_id)
      )
    `);

    // Cart items table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id INT PRIMARY KEY AUTO_INCREMENT,
        session_id VARCHAR(255) NOT NULL,
        product_id INT NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        UNIQUE KEY unique_session_product (session_id, product_id),
        INDEX idx_session (session_id),
        INDEX idx_product (product_id)
      )
    `);

    // Promo codes table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id INT PRIMARY KEY AUTO_INCREMENT,
        code VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        discount_type ENUM('percentage', 'fixed') NOT NULL,
        discount_value DECIMAL(10,2) NOT NULL,
        minimum_order_amount DECIMAL(10,2) DEFAULT 0.00,
        max_uses INT,
        used_count INT DEFAULT 0,
        valid_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        valid_until TIMESTAMP,
        status ENUM('active', 'inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_code (code),
        INDEX idx_status (status),
        INDEX idx_valid_until (valid_until)
      )
    `);

    // User addresses table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS user_addresses (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        address_type ENUM('billing', 'shipping', 'both') DEFAULT 'both',
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        address_line1 VARCHAR(255) NOT NULL,
        address_line2 VARCHAR(255),
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NOT NULL,
        zip_code VARCHAR(20) NOT NULL,
        country VARCHAR(100) DEFAULT 'United States',
        phone VARCHAR(20),
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user (user_id),
        INDEX idx_type (address_type),
        INDEX idx_default (is_default)
      )
    `);

    // Notifications table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type ENUM('info', 'success', 'warning', 'error') DEFAULT 'info',
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user (user_id),
        INDEX idx_read (is_read),
        INDEX idx_created_at (created_at)
      )
    `);

    console.log('✅ All tables created successfully');
  } catch (error) {
    console.error('❌ Error creating tables:', error);
    throw error;
  }
};

// Insert sample data
const insertDummyData = async () => {
  try {
    console.log('📝 Inserting sample data...');

    // Check if data already exists
    const existingCategories = await executeQuery('SELECT COUNT(*) as count FROM categories');
    if (existingCategories[0].count > 0) {
      console.log('✅ Sample data already exists, skipping...');
      return;
    }

    // Insert categories
    await executeQuery(`
      INSERT INTO categories (name, description) VALUES
      ('Oils', 'Organic cooking and finishing oils'),
      ('Sweeteners', 'Natural sweeteners and honey'),
      ('Grains', 'Organic grains and cereals'),
      ('Nuts', 'Raw and roasted organic nuts'),
      ('Beverages', 'Organic teas and drinks')
    `);

    // Insert products
    await executeQuery(`
      INSERT INTO products (name, description, price, original_price, category_id, stock, rating, reviews_count, badge) VALUES
      ('Organic Olive Oil', 'Extra virgin olive oil from organic Mediterranean olives', 24.99, 29.99, 1, 15, 4.8, 124, 'Best Seller'),
      ('Raw Honey', 'Pure raw honey from wildflower meadows', 18.99, NULL, 2, 8, 4.9, 89, 'New'),
      ('Organic Quinoa', 'Premium organic quinoa from South America', 12.99, NULL, 3, 25, 4.7, 156, NULL),
      ('Coconut Oil', 'Virgin coconut oil for cooking and beauty', 16.99, 19.99, 1, 12, 4.6, 98, 'Sale'),
      ('Organic Almonds', 'Raw organic almonds from California', 22.99, NULL, 4, 20, 4.8, 203, NULL),
      ('Green Tea', 'Premium organic green tea leaves', 14.99, NULL, 5, 30, 4.7, 145, NULL)
    `);

    // Insert product images
    await executeQuery(`
      INSERT INTO product_images (product_id, image_url, is_primary, display_order) VALUES
      (1, 'https://images.pexels.com/photos/33783/olive-oil-salad-dressing-cooking-olive.jpg?auto=compress&cs=tinysrgb&w=400', TRUE, 1),
      (1, 'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=600', FALSE, 2),
      (1, 'https://images.pexels.com/photos/1018843/pexels-photo-1018843.jpeg?auto=compress&cs=tinysrgb&w=600', FALSE, 3),
      (2, 'https://images.pexels.com/photos/327098/pexels-photo-327098.jpeg?auto=compress&cs=tinysrgb&w=400', TRUE, 1),
      (3, 'https://images.pexels.com/photos/4198020/pexels-photo-4198020.jpeg?auto=compress&cs=tinysrgb&w=400', TRUE, 1),
      (4, 'https://images.pexels.com/photos/2235576/pexels-photo-2235576.jpeg?auto=compress&cs=tinysrgb&w=400', TRUE, 1),
      (5, 'https://images.pexels.com/photos/1295572/pexels-photo-1295572.jpeg?auto=compress&cs=tinysrgb&w=400', TRUE, 1),
      (6, 'https://images.pexels.com/photos/1638280/pexels-photo-1638280.jpeg?auto=compress&cs=tinysrgb&w=400', TRUE, 1)
    `);

    // Insert product specifications
    await executeQuery(`
      INSERT INTO product_specifications (product_id, spec_key, spec_value) VALUES
      (1, 'Origin', 'Mediterranean Region'),
      (1, 'Processing', 'Cold-pressed'),
      (1, 'Acidity', 'Less than 0.8%'),
      (1, 'Volume', '500ml'),
      (1, 'Certification', 'USDA Organic, Non-GMO'),
      (2, 'Origin', 'Wildflower Meadows'),
      (2, 'Processing', 'Raw, Unfiltered'),
      (2, 'Volume', '250ml'),
      (2, 'Certification', 'USDA Organic'),
      (3, 'Origin', 'South America'),
      (3, 'Processing', 'Organic'),
      (3, 'Volume', '500g'),
      (3, 'Certification', 'USDA Organic, Non-GMO')
    `);

    // Insert product features
    await executeQuery(`
      INSERT INTO product_features (product_id, feature_text, display_order) VALUES
      (1, '100% Organic and USDA Certified', 1),
      (1, 'Cold-pressed for maximum nutrition', 2),
      (1, 'Rich in antioxidants and healthy fats', 3),
      (1, 'Perfect for cooking and salad dressings', 4),
      (1, 'Sustainably sourced from family farms', 5),
      (2, 'Pure and natural honey', 1),
      (2, 'No artificial additives', 2),
      (2, 'Rich in natural enzymes', 3),
      (3, 'Complete protein source', 1),
      (3, 'Gluten-free', 2),
      (3, 'High in fiber and minerals', 3)
    `);

    // Hash password for admin user
    const adminPassword = await bcrypt.hash('admin123', 10);
    const customerPassword = await bcrypt.hash('customer123', 10);

    // Insert users
    await executeQuery(`
      INSERT INTO users (name, email, password_hash, role, phone, status) VALUES
      ('Admin User', 'admin@olifera.com', ?, 'admin', '+1 (555) 345-6789', 'active'),
      ('John Doe', 'john@example.com', ?, 'customer', '+1 (555) 123-4567', 'active')
    `, [adminPassword, customerPassword]);

    console.log('✅ Sample data inserted successfully');
  } catch (error) {
    console.error('❌ Error inserting sample data:', error);
    throw error;
  }
};

module.exports = { createTables, insertDummyData };